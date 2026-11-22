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
    showScreen(screenIndex + (ev == InputEvent::Previous ? -1 : 1), b);
    return;
  }
  bool paused = lastButtonMs && now - lastButtonMs < cfg::kButtonPauseMs;
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
    handleInput(ev, *b);
    if (netStatus.updating) {
      displayText("UPDATING", "firmware", "please", "wait", b->brightness);
    } else if (netStatus.portalActive && now % 15000 < 5000) {
      showSetupHelp();  // alternate with the data so it's never hidden
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
