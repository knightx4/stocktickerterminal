// Stock ticker: thin-client firmware for the Matrix Portal S3.
//
// The server renders every screen; this firmware fetches them (net.cpp),
// draws them (display.cpp) and switches between them on button presses,
// double-taps or a timer. See docs/protocol.md.
//
// Boot options (hold while pressing Reset):
//   UP    open the Wi-Fi setup portal ("Ticker-Setup")
//   DOWN  toggle the FM6126A panel init (try this if the panel stays dark)
#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <Preferences.h>
#include <esp_task_wdt.h>

#include "board.h"
#include "config.h"
#include "display.h"
#include "input.h"
#include "net.h"
#include "ota.h"

namespace {

int screenIndex = 0;
char screenId[33] = "";
uint32_t screenShownMs = 0;
uint32_t lastButtonMs = 0;
const Bundle* lastBundle = nullptr;  // to notice when a new bundle arrives
uint32_t lastBundleCrc = 0;

// Birthday autoplay: on the day, jump to the animation screen every few
// minutes, play it once, then go back to where we were.
uint32_t lastAutoplayMs = 0;
char returnId[33] = "";  // screen to return to after an autoplay ("" = none)

int findScreen(const Bundle& b, const char* id) {
  for (int i = 0; i < b.screenCount; i++)
    if (strcmp(b.screens[i].id, id) == 0) return i;
  return -1;
}

int findAnimationScreen(const Bundle& b) {
  for (int i = 0; i < b.screenCount; i++)
    if (b.screens[i].kind == kScreenAnimation) return i;
  return -1;
}

// The animation for screen s, if it's downloaded. Call with the bundle locked.
const Animation* animationFor(const Screen& s) {
  return s.kind == kScreenAnimation ? lockedAnimation(s.assetCrc) : nullptr;
}

// Timed events (opening/closing bell): played once, at their time, over
// whatever screen is showing; then that screen simply continues.
constexpr uint32_t kEventLateSeconds = 90;  // still play if we're up to this late
uint32_t eventCrc = 0;        // event animation playing now (0 = none)
uint32_t eventStartMs = 0;
uint32_t lastEventPlayAt = 0;  // so each event plays only once

// Current unix time from the bundle (server time + elapsed), or -1 if unknown.
int64_t unixNow(const Bundle& b) {
  if (b.fromCache || !b.serverTime) return -1;
  return (int64_t)b.serverTime + (millis() - b.fetchedAtMs) / 1000;
}

// Starts a due event if there is one. Call with the bundle locked.
void checkEvents(const Bundle& b) {
  if (eventCrc) return;
  int64_t t = unixNow(b);
  if (t < 0) return;
  for (int i = 0; i < b.eventCount; i++) {
    const Event& e = b.events[i];
    if (!e.playAt || e.playAt == lastEventPlayAt) continue;
    if (t < e.playAt || t >= (int64_t)e.playAt + kEventLateSeconds) continue;
    if (!lockedAnimation(e.assetCrc)) continue;  // not downloaded (yet)
    eventCrc = e.assetCrc;
    eventStartMs = millis();
    lastEventPlayAt = e.playAt;
    Serial.printf("[main] Playing event '%s'\n", e.assetId);
    return;
  }
}

void startWatchdog() {
  esp_task_wdt_config_t wdt = {
      .timeout_ms = cfg::kWatchdogMs, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(nullptr);  // this (loop) task
}

bool readFm6126aSetting() {
  Preferences prefs;
  prefs.begin("ticker", false);  // same setting the panel test uses
  bool on = prefs.getBool("fm6126a", false);
  if (digitalRead(board::kButtonDown) == LOW) {
    on = !on;
    prefs.putBool("fm6126a", on);
    Serial.printf("DOWN held at boot: FM6126A init now %s\n", on ? "ON" : "OFF");
  }
  prefs.end();
  return on;
}

void showScreen(int index, const Bundle& b) {
  screenIndex = (index + b.screenCount) % b.screenCount;
  strlcpy(screenId, b.screens[screenIndex].id, sizeof screenId);
  currentScreenId = screenId;
  screenShownMs = millis();
}

// After a new bundle arrives, stay on the same screen if it still exists.
void followScreen(const Bundle& b) {
  for (int i = 0; i < b.screenCount; i++) {
    if (strcmp(b.screens[i].id, screenId) == 0) {
      screenIndex = i;
      return;
    }
  }
  showScreen(min(screenIndex, b.screenCount - 1), b);
}

void handleInput(InputEvent ev, const Bundle& b) {
  uint32_t now = millis();
  bool tap = ev == InputEvent::Tap && (b.flags & kFlagDoubleTap);
  if (ev == InputEvent::Next || ev == InputEvent::Previous || tap) {
    lastButtonMs = now;
    returnId[0] = 0;  // he took control; don't jump back after an autoplay
    showScreen(screenIndex + (ev == InputEvent::Previous ? -1 : 1), b);
    return;
  }
  bool paused = lastButtonMs && now - lastButtonMs < cfg::kButtonPauseMs;

  // Autoplay finished: return to the screen we were on.
  const Animation* playing = animationFor(b.screens[screenIndex]);
  if (returnId[0] && playing && now - screenShownMs >= playing->totalMs) {
    int back = findScreen(b, returnId);
    returnId[0] = 0;
    showScreen(back >= 0 ? back : 0, b);
    return;
  }
  // Time for an autoplay (only while the server says it's the day).
  int animIdx = findAnimationScreen(b);
  if (b.autoplayMinutes && animIdx >= 0 && animIdx != screenIndex && !paused && !returnId[0] &&
      animationFor(b.screens[animIdx]) &&
      (!lastAutoplayMs || now - lastAutoplayMs >= b.autoplayMinutes * 60000UL)) {
    lastAutoplayMs = now;
    strlcpy(returnId, b.screens[screenIndex].id, sizeof returnId);
    showScreen(animIdx, b);
    return;
  }
  if (returnId[0]) return;  // don't auto-advance away from an autoplay
  if (b.dwellSeconds && b.screenCount > 1 && !paused &&
      now - screenShownMs >= b.dwellSeconds * 1000UL) {
    showScreen(screenIndex + 1, b);
  }
}

StatusLight statusFor(const Bundle& b) {
  uint32_t now = millis();
  uint32_t since = netStatus.lastSuccessMs ? netStatus.lastSuccessMs : netStatus.bootMs;
  uint32_t age = now - since;
  if (age > cfg::kRedOfflineMs) return StatusLight::Red;
  uint32_t staleAfter = max<uint32_t>(3UL * b.pollSeconds * 1000, 300000);
  if (b.fromCache || (b.flags & kFlagStale) || age > staleAfter) return StatusLight::Amber;
  return StatusLight::None;
}

// Seconds since local midnight, or -1 if we don't know the time.
int32_t localSeconds(const Bundle& b) {
  if (b.fromCache || !b.serverTime) return -1;
  int64_t t = (int64_t)b.serverTime + (millis() - b.fetchedAtMs) / 1000 + b.utcOffsetMin * 60;
  return (int32_t)(t % 86400);
}

void showSetupHelp() { displayText("WIFI SETUP", "Join wifi", "Ticker-", "Setup"); }

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Stock ticker, firmware %d ===\n", FW_VERSION);

  // The status LED would glow through the smoked window, so keep it off.
  Adafruit_NeoPixel led(1, board::kNeoPixel, NEO_GRB + NEO_KHZ800);
  led.begin();
  led.clear();
  led.show();

  inputBegin();
  bool fm6126a = readFm6126aSetting();
  bool forcePortal = upHeld();
  netInit();  // reads the flash cache: do it before the panel starts refreshing
  if (!displayBegin(fm6126a)) {
    Serial.println("Display failed to start; rebooting in 10 s");
    delay(10000);
    ESP.restart();
  }
  displayText("STARTING", forcePortal ? "wifi setup" : "");

  startWatchdog();
  netBegin(forcePortal);
}

void loop() {
  esp_task_wdt_reset();
  InputEvent ev = inputPoll();
  uint32_t now = millis();

  Bundle* b = lockBundle();
  if (b && b->screenCount) {
    // Compare the CRC too: a new bundle can be allocated at the old address.
    if (b != lastBundle || b->crc != lastBundleCrc || screenIndex >= b->screenCount) {
      followScreen(*b);
      lastBundle = b;
      lastBundleCrc = b->crc;
    }
    checkEvents(*b);
    const Animation* event = eventCrc ? lockedAnimation(eventCrc) : nullptr;
    bool pressed = ev == InputEvent::Next || ev == InputEvent::Previous ||
                   (ev == InputEvent::Tap && (b->flags & kFlagDoubleTap));
    if (eventCrc && (!event || now - eventStartMs >= event->totalMs || pressed)) {
      eventCrc = 0;  // finished, dropped, or a button/tap dismissed it
      event = nullptr;
      ev = InputEvent::None;  // the press only dismisses the bell
    }
    handleInput(ev, *b);
    const Animation* playing = animationFor(b->screens[screenIndex]);
    if (netStatus.updating) {
      displayText("UPDATING", "firmware", "please", "wait", b->brightness);
    } else if (netStatus.portalActive && now % 15000 < 5000) {
      showSetupHelp();  // alternate with the data so it's never hidden
    } else if (event) {
      displayAnimation(*event, now - eventStartMs, b->brightness);
    } else if (playing) {
      displayAnimation(*playing, now - screenShownMs, b->brightness);
    } else if (b->screens[screenIndex].kind == kScreenAnimation) {
      displayScreen(*b, screenIndex, 0, -1, StatusLight::None);  // poster while it downloads
    } else {
      displayScreen(*b, screenIndex, now - screenShownMs, localSeconds(*b), statusFor(*b));
    }
    unlockBundle();
  } else {
    unlockBundle();
    if (netStatus.portalActive) showSetupHelp();
    else if (!netStatus.connected) displayText("CONNECTING", "to wifi");
    else displayText("WAITING", "for data");
  }

  delay(16);  // ~60 fps
}
