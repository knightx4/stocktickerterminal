#include "ota.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include "config.h"
#include "net.h"

volatile const char* currentScreenId = "";

// Keep a freshly updated image "pending" until it has fetched a bundle
// (net.cpp then calls esp_ota_mark_app_valid_cancel_rollback()). If it
// crashes or resets first, the bootloader rolls back to the previous image.
extern "C" bool verifyRollbackLater() { return true; }

namespace {

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_EXT: return "reset-button";
    default: return "other";
  }
}

// Stream adapter that writes an HTTP body straight into the OTA partition.
class UpdateStream : public Stream {
 public:
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t* data, size_t n) override {
    esp_task_wdt_reset();
    return Update.write(const_cast<uint8_t*>(data), n);
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

void runUpdate(int version, const String& url, const String& md5) {
  Serial.printf("[ota] Updating to firmware %d from %s\n", version, url.c_str());
  netStatus.updating = true;

  WiFiClientSecure client;
  client.setInsecure();  // TODO: pin a root CA (see net.cpp)
  HTTPClient http;
  http.setConnectTimeout(cfg::kHttpTimeoutMs);
  http.setTimeout(cfg::kHttpTimeoutMs);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);  // GitHub release assets redirect
  bool ok = http.begin(client, url) && http.GET() == 200;
  int size = ok ? http.getSize() : 0;
  ok = ok && Update.begin(size > 0 ? size : UPDATE_SIZE_UNKNOWN);
  if (ok) Update.setMD5(md5.c_str());
  if (ok) {
    UpdateStream sink;
    int written = http.writeToStream(&sink);
    ok = written > 0 && Update.end(true);  // end() verifies the MD5 and the image
  }
  http.end();

  if (ok) {
    Serial.println("[ota] Update written; rebooting");
    delay(200);
    ESP.restart();
  }
  Serial.printf("[ota] Update failed: %s\n", Update.errorString());
  Update.abort();
  netStatus.updating = false;
}

}  // namespace

void sendPingAndMaybeUpdate() {
  JsonDocument req;
  req["fw"] = FW_VERSION;
  req["uptime"] = millis() / 1000;
  req["rssi"] = WiFi.RSSI();
  req["heap"] = ESP.getFreeHeap();
  req["screen"] = (const char*)currentScreenId;
  req["ip"] = WiFi.localIP().toString();
  req["reset"] = resetReason();
  req["err"] = netLastError();
  String body;
  serializeJson(req, body);

  WiFiClientSecure client;
  client.setInsecure();  // TODO: pin a root CA (see net.cpp)
  HTTPClient http;
  http.setConnectTimeout(cfg::kHttpTimeoutMs);
  http.setTimeout(cfg::kHttpTimeoutMs);
  String url = String(SERVER_URL) + "/api/ping?t=" + DEVICE_TOKEN;
  if (!http.begin(client, url)) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String resp = code == 200 ? http.getString() : "";
  http.end();
  if (code != 200) {
    Serial.printf("[ota] Ping failed: HTTP %d\n", code);
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  JsonVariant fw = doc["firmware"];
  if (fw.isNull()) return;
  int version = fw["version"] | 0;
  String fwUrl = fw["url"] | "";
  String md5 = fw["md5"] | "";
  if (version <= FW_VERSION) return;
  if (!fwUrl.startsWith("https://") || md5.length() != 32) {
    Serial.println("[ota] Ignoring firmware offer without an https URL and MD5");
    return;
  }
  runUpdate(version, fwUrl, md5);
}
