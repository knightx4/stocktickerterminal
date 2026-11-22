#include "net.h"

#include <FFat.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>

#include "config.h"
#include "ota.h"

NetStatus netStatus;

namespace {

SemaphoreHandle_t bundleMutex;
Bundle* current = nullptr;   // owned by the net task; display reads it under the mutex
String lastError;
WiFiManager wm;

constexpr const char* kCachePath = "/bundle.bin";
bool ffatOk = false;
uint32_t savedCrc = 0;
uint32_t lastSaveMs = 0;

// Stream adapter that collects an HTTP body into a growing PSRAM buffer.
// HTTPClient::writeToStream() handles chunked transfer encoding for us.
class BufferStream : public Stream {
 public:
  uint8_t* buf = nullptr;
  size_t len = 0, cap = 0;
  bool overflow = false;

  ~BufferStream() { free(buf); }
  uint8_t* release() { uint8_t* b = buf; buf = nullptr; len = cap = 0; return b; }

  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t* data, size_t n) override {
    esp_task_wdt_reset();
    if (len + n > cfg::kMaxBundleBytes) { overflow = true; return 0; }
    if (len + n > cap) {
      size_t newCap = max(cap * 2, len + n + 16 * 1024);
      newCap = min(newCap, cfg::kMaxBundleBytes);
      uint8_t* nb = (uint8_t*)ps_realloc(buf, newCap);
      if (!nb) { overflow = true; return 0; }
      buf = nb;
      cap = newCap;
    }
    memcpy(buf + len, data, n);
    len += n;
    return n;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

void setError(const String& e) {
  lastError = e;
  Serial.println("[net] " + e);
}

// Replaces the current bundle. Takes ownership of `fresh`.
void swapIn(Bundle* fresh) {
  xSemaphoreTake(bundleMutex, portMAX_DELAY);
  Bundle* old = current;
  current = fresh;
  xSemaphoreGive(bundleMutex);
  if (old) { freeBundle(old); delete old; }
}

// ---------------------------------------------------------------- flash cache

void loadCache() {
  ffatOk = FFat.begin(true);  // formats the partition the first time
  if (!ffatOk) { Serial.println("[net] FFat mount failed; no offline cache"); return; }
  File f = FFat.open(kCachePath, "r");
  if (!f) return;
  size_t size = f.size();
  uint8_t* data = size && size <= cfg::kMaxBundleBytes ? (uint8_t*)ps_malloc(size) : nullptr;
  if (data && f.read(data, size) == size) {
    Bundle* b = new Bundle();
    String err;
    if (parseBundle(data, size, *b, err)) {
      b->fromCache = true;
      savedCrc = b->contentCrc;
      swapIn(b);
      Serial.printf("[net] Loaded cached bundle (%u bytes, %u screens)\n", size, b->screenCount);
      data = nullptr;
    } else {
      delete b;
      Serial.println("[net] Cached bundle invalid: " + err);
    }
  }
  free(data);
  f.close();
}

// Writing to flash pauses the panel's refresh timer (its interrupt can't run
// while flash is busy), which shows as a brief burst of garbled colour. So we
// save only when the screens actually changed, at most every kSaveIntervalMs,
// and only while the panel is dimmed for the night - unless there is no saved
// copy at all yet.
void maybeSaveCache() {
  if (!ffatOk) return;
  if (lastSaveMs && millis() - lastSaveMs < cfg::kSaveIntervalMs) return;
  // Only this task frees bundles, so `current` stays valid while we write it.
  Bundle* b = current;
  if (!b || b->fromCache || b->contentCrc == savedCrc) return;
  bool haveCopy = savedCrc != 0;
  if (haveCopy && b->brightness > cfg::kSaveMaxBrightness) return;
  lastSaveMs = millis();
  File f = FFat.open("/bundle.tmp", "w");
  if (!f) return;
  bool ok = f.write(b->data, b->size) == b->size;
  f.close();
  if (ok) {
    FFat.remove(kCachePath);
    ok = FFat.rename("/bundle.tmp", kCachePath);
  }
  if (ok) savedCrc = b->contentCrc;
  Serial.printf("[net] Saved bundle to flash: %s\n", ok ? "ok" : "FAILED");
}

// ---------------------------------------------------------------- fetching

bool fetchBundle() {
  WiFiClientSecure client;
  // TODO: pin a root CA. Without it the connection is encrypted but the
  // server is not authenticated.
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(cfg::kHttpTimeoutMs);
  http.setTimeout(cfg::kHttpTimeoutMs);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  String url = String(SERVER_URL) + "/api/bundle?t=" + DEVICE_TOKEN;
  if (!http.begin(client, url)) { setError("bundle: bad URL"); return false; }
  int code = http.GET();
  if (code != 200) {
    setError("bundle: HTTP " + String(code) + " " + http.errorToString(code));
    http.end();
    return false;
  }
  BufferStream body;
  int written = http.writeToStream(&body);
  http.end();
  if (written < 0 || body.overflow) {
    setError("bundle: read failed " + String(written));
    return false;
  }

  size_t len = body.len;
  uint8_t* data = body.release();
  Bundle* b = new Bundle();
  String err;
  if (!parseBundle(data, len, *b, err)) {
    free(data);
    delete b;
    setError("bundle: " + err);
    return false;
  }
  b->fetchedAtMs = millis();
  swapIn(b);
  netStatus.lastSuccessMs = millis();
  lastError = "";

  // A freshly OTA-updated image proves itself by fetching data once. Only do
  // it once per boot: it can write to flash, which disturbs the panel.
  static bool markedValid = false;
  if (!markedValid) {
    esp_ota_mark_app_valid_cancel_rollback();
    markedValid = true;
  }
  return true;
}

// ---------------------------------------------------------------- Wi-Fi

void startPortal() {
  Serial.println("[net] Opening Wi-Fi setup portal");
  wm.setConfigPortalTimeout(cfg::kPortalOpenSeconds);
  wm.startConfigPortal(cfg::kPortalName);
}

void netTask(void*) {
  esp_task_wdt_add(nullptr);

  uint32_t nextFetchMs = 0, nextPingMs = 0, retryDelayMs = cfg::kRetryMinMs;
  uint32_t offlineSinceMs = millis();  // start of the current outage (or of the last portal)
  bool wasConnected = false, wasPortal = wm.getConfigPortalActive();

  while (true) {
    esp_task_wdt_reset();
    uint32_t now = millis();

    bool portal = wm.getConfigPortalActive();
    if (portal && wm.process()) Serial.println("[net] Portal: new Wi-Fi saved and connected");
    portal = wm.getConfigPortalActive();
    if (wasPortal && !portal && WiFi.status() != WL_CONNECTED) {
      // Portal timed out: go back to retrying the saved network. WiFiManager
      // pauses station mode while the portal is open, so restart it here.
      Serial.println("[net] Portal closed; retrying saved Wi-Fi");
      WiFi.mode(WIFI_STA);
      WiFi.begin();
      offlineSinceMs = now;
    }
    wasPortal = portal;
    netStatus.portalActive = portal;

    bool connected = WiFi.status() == WL_CONNECTED;
    netStatus.connected = connected;
    if (connected && !wasConnected) {
      Serial.printf("[net] Wi-Fi connected, IP %s, RSSI %d\n", WiFi.localIP().toString().c_str(),
                    WiFi.RSSI());
      if (portal) wm.stopConfigPortal();
      nextFetchMs = now;  // fetch right away
      nextPingMs = now;
    }
    if (!connected && wasConnected) offlineSinceMs = now;
    wasConnected = connected;

    if (connected) {
      if ((int32_t)(now - nextFetchMs) >= 0) {
        if (fetchBundle()) {
          Bundle* b = current;
          nextFetchMs = millis() + (b ? b->pollSeconds * 1000UL : cfg::kDefaultPollMs);
          retryDelayMs = cfg::kRetryMinMs;
        } else {
          nextFetchMs = millis() + retryDelayMs;
          uint32_t maxRetry = current ? current->pollSeconds * 1000UL : cfg::kDefaultPollMs;
          retryDelayMs = min(retryDelayMs * 2, max(maxRetry, cfg::kRetryMinMs));
        }
      }
      if ((int32_t)(now - nextPingMs) >= 0) {
        nextPingMs = millis() + cfg::kPingIntervalMs;
        sendPingAndMaybeUpdate();  // may reboot into new firmware
      }
      maybeSaveCache();
    } else if (!portal && now - offlineSinceMs > cfg::kOfflineBeforePortalMs) {
      // Long outage: maybe the Wi-Fi changed. Offer the portal for a while;
      // when it times out we go back to retrying the saved network.
      startPortal();
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void wifiBegin(bool forcePortal) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // steadier latency; power is not a concern here
  wm.setConfigPortalBlocking(false);
  wm.setConnectTimeout(20);  // when testing credentials entered in the portal
  wm.setDebugOutput(false);
  wm.setTitle("Stock Ticker");
  if (forcePortal || !wm.getWiFiIsSaved()) {
    startPortal();
  } else {
    // Saved network: keep retrying in the background. We deliberately don't
    // open the portal on a quick failure, because after a power cut the
    // router usually takes longer to boot than we do.
    WiFi.begin();
  }
}

void netTaskEntry(void* arg) {
  wifiBegin((bool)arg);
  netTask(nullptr);
}

}  // namespace

void netBegin(bool forcePortal) {
  bundleMutex = xSemaphoreCreateMutex();
  netStatus.bootMs = millis();
  loadCache();
  // Core 0 alongside the Wi-Fi stack; the display loop stays on core 1.
  xTaskCreatePinnedToCore(netTaskEntry, "net", 16384, (void*)forcePortal, 1, nullptr, 0);
}

Bundle* lockBundle() {
  xSemaphoreTake(bundleMutex, portMAX_DELAY);
  return current;
}

void unlockBundle() { xSemaphoreGive(bundleMutex); }

String netLastError() { return lastError; }
