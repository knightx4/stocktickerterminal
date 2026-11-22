// Milestone 1: panel + hardware test for the Matrix Portal S3.
//
// Cycles through test pages every 4 s. Press UP or DOWN to step manually
// (auto-advance stops once you press a button).
//
// Boot options:
//   Hold DOWN while pressing RESET  -> toggle FM6126A init (remembered).
//                                      Try this if the panel stays blank.
//
// Pages: 0 info/orientation, 1-4 solid R/G/B/W, 5 gradients, 6 grid,
//        7 Wi-Fi scan with the panel running, 8 ticker preview.
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_Protomatter.h>
#include <Preferences.h>
#include <WiFi.h>
#include <Wire.h>

#include "../board.h"
#include "../fm6126a.h"

// 5 bits per color channel, double-buffered so scrolling does not flicker.
Adafruit_Protomatter matrix(board::kWidth, 5, 1, board::rgbPins, 4, board::addrPins,
                            board::kClockPin, board::kLatchPin, board::kOePin, true);
Adafruit_NeoPixel statusLed(1, board::kNeoPixel, NEO_GRB + NEO_KHZ800);
Preferences prefs;

constexpr int kPageCount = 9;
constexpr uint32_t kAutoAdvanceMs = 4000;

int page = 0;
bool autoAdvance = true;
uint32_t pageStartedMs = 0;
bool useFm6126a = false;
bool accelOk = false;

// Wi-Fi scan results (page 7)
int wifiCount = -1;
int wifiBestRssi = 0;
String wifiBestName;

// ---------------------------------------------------------------- helpers

// Protomatter has no global brightness, so we scale colors ourselves.
// 0-255. Keeps full-white within what a 5V/3A USB supply can deliver.
uint8_t brightness = 120;

uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return matrix.color565(r * brightness / 255, g * brightness / 255, b * brightness / 255);
}

bool readAccelWhoAmI() {
  Wire.begin();
  Wire.beginTransmission(board::kAccelAddr);
  Wire.write(0x0F);  // WHO_AM_I register
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(board::kAccelAddr, (uint8_t)1) != 1) return false;
  return Wire.read() == 0x33;  // LIS3DH identity
}

void text(int x, int y, const char* s, uint16_t color) {
  matrix.setCursor(x, y);
  matrix.setTextColor(color);
  matrix.print(s);
}

void setStatusLed(uint8_t r, uint8_t g, uint8_t b) {
  statusLed.setPixelColor(0, statusLed.Color(r, g, b));
  statusLed.show();
}

// ---------------------------------------------------------------- buttons

struct Button {
  uint8_t pin;
  bool lastDown = false;
  uint32_t lastChangeMs = 0;

  // Returns true once per press (debounced).
  bool pressed() {
    bool down = digitalRead(pin) == LOW;
    uint32_t now = millis();
    if (down != lastDown && now - lastChangeMs > 30) {
      lastDown = down;
      lastChangeMs = now;
      return down;
    }
    return false;
  }
};

Button upButton{board::kButtonUp};
Button downButton{board::kButtonDown};

// ---------------------------------------------------------------- pages

void drawInfo() {
  text(4, 1, "PANEL TEST", rgb(255, 160, 0));
  text(1, 12, useFm6126a ? "DRV FM6126A" : "DRV STD", rgb(0, 200, 255));
  text(1, 22, accelOk ? "ACCEL OK" : "ACCEL --", accelOk ? rgb(0, 255, 0) : rgb(255, 0, 0));
  // Corner markers to check orientation: TL red, TR green, BL blue, BR white.
  matrix.fillRect(0, 0, 2, 2, rgb(255, 0, 0));
  matrix.fillRect(62, 0, 2, 2, rgb(0, 255, 0));
  matrix.fillRect(0, 30, 2, 2, rgb(0, 0, 255));
  matrix.fillRect(62, 30, 2, 2, rgb(255, 255, 255));
}

void drawSolid(uint8_t r, uint8_t g, uint8_t b, const char* label) {
  matrix.fillScreen(rgb(r, g, b));
  text(2, 2, label, r + g + b > 300 ? 0 : rgb(255, 255, 255));
}

void drawGradients() {
  for (int x = 0; x < 64; x++) {
    uint8_t v = x * 4;
    matrix.drawFastVLine(x, 0, 8, rgb(v, 0, 0));
    matrix.drawFastVLine(x, 8, 8, rgb(0, v, 0));
    matrix.drawFastVLine(x, 16, 8, rgb(0, 0, v));
    matrix.drawFastVLine(x, 24, 8, rgb(v, v, v));
  }
}

void drawGrid() {
  // Lines every 8 px; a missing or doubled row means an address-line problem.
  for (int x = 0; x < 64; x += 8) matrix.drawFastVLine(x, 0, 32, rgb(0, 120, 255));
  for (int y = 0; y < 32; y += 8) matrix.drawFastHLine(0, y, 64, rgb(255, 120, 0));
  matrix.drawRect(0, 0, 64, 32, rgb(255, 255, 255));
}

void runWifiScan() {
  // Scanning while the panel refreshes checks the two coexist on this board.
  WiFi.mode(WIFI_STA);
  wifiCount = WiFi.scanNetworks();
  wifiBestRssi = -999;
  wifiBestName = "";
  for (int i = 0; i < wifiCount; i++) {
    if (WiFi.RSSI(i) > wifiBestRssi) {
      wifiBestRssi = WiFi.RSSI(i);
      wifiBestName = WiFi.SSID(i);
    }
  }
  WiFi.scanDelete();
  Serial.printf("Wi-Fi scan: %d networks, best %s (%d dBm)\n", wifiCount, wifiBestName.c_str(),
                wifiBestRssi);
}

void drawWifi() {
  text(1, 1, "WIFI SCAN", rgb(255, 160, 0));
  char line[24];
  if (wifiCount < 0) {
    text(1, 12, "scanning", rgb(200, 200, 200));
    return;
  }
  snprintf(line, sizeof line, "%d nets", wifiCount);
  text(1, 12, line, wifiCount > 0 ? rgb(0, 255, 0) : rgb(255, 0, 0));
  if (wifiCount > 0) {
    snprintf(line, sizeof line, "%d dBm", wifiBestRssi);
    text(1, 22, line, rgb(0, 200, 255));
  }
}

void drawTickerPreview() {
  // Rough preview of the real ticker: top bar + scrolling quotes.
  text(1, 1, "OPEN", rgb(0, 255, 0));
  text(35, 1, "10:42", rgb(200, 200, 200));
  matrix.drawFastHLine(0, 10, 64, rgb(60, 60, 60));

  const char* sym[] = {"AAPL", "MSFT", "NVDA", "SPY"};
  const char* px[] = {"231.45", "418.10", "142.88", "602.31"};
  const char* chg[] = {"+1.2%", "-0.4%", "+2.7%", "+0.6%"};
  const int segmentWidth = 70;
  const int total = segmentWidth * 4;
  int offset = (millis() / 40) % total;
  for (int i = 0; i < 4; i++) {
    int x = 64 - offset + i * segmentWidth;
    if (x < -segmentWidth) x += total;
    bool up = chg[i][0] == '+';
    text(x, 14, sym[i], rgb(255, 255, 255));
    text(x, 23, px[i], rgb(200, 200, 200));
    text(x + 40, 14, chg[i], up ? rgb(0, 255, 0) : rgb(255, 0, 0));
  }
}

void drawPage() {
  matrix.fillScreen(0);
  switch (page) {
    case 0: drawInfo(); break;
    case 1: drawSolid(255, 0, 0, "RED"); break;
    case 2: drawSolid(0, 255, 0, "GREEN"); break;
    case 3: drawSolid(0, 0, 255, "BLUE"); break;
    case 4: drawSolid(255, 255, 255, "WHITE"); break;
    case 5: drawGradients(); break;
    case 6: drawGrid(); break;
    case 7: drawWifi(); break;
    case 8: drawTickerPreview(); break;
  }
  matrix.show();
}

void goToPage(int p) {
  page = (p + kPageCount) % kPageCount;
  pageStartedMs = millis();
  Serial.printf("Page %d\n", page);
  if (page == 7) {
    wifiCount = -1;
    drawPage();  // show "scanning" before the blocking scan
    runWifiScan();
    pageStartedMs = millis();  // give the result a full page duration
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Ticker panel test ===");

  statusLed.begin();
  statusLed.setBrightness(40);
  setStatusLed(0, 0, 255);  // blue = booting

  pinMode(board::kButtonUp, INPUT_PULLUP);
  pinMode(board::kButtonDown, INPUT_PULLUP);

  prefs.begin("ticker", false);
  useFm6126a = prefs.getBool("fm6126a", false);
  if (digitalRead(board::kButtonDown) == LOW) {
    useFm6126a = !useFm6126a;
    prefs.putBool("fm6126a", useFm6126a);
    Serial.printf("DOWN held at boot: FM6126A init now %s\n", useFm6126a ? "ON" : "OFF");
    while (digitalRead(board::kButtonDown) == LOW) delay(10);  // wait for release
  }
  if (useFm6126a) fm6126aInit();

  ProtomatterStatus status = matrix.begin();
  Serial.printf("Protomatter begin: %d (0 = OK)\n", (int)status);
  if (status != PROTOMATTER_OK) {
    setStatusLed(255, 0, 0);  // red = display failed to start
    while (true) delay(1000);
  }
  matrix.setTextWrap(false);

  accelOk = readAccelWhoAmI();
  Serial.printf("LIS3DH at 0x19: %s\n", accelOk ? "found" : "NOT found");
  Serial.printf("FM6126A init: %s\n", useFm6126a ? "ON" : "OFF");

  setStatusLed(0, 255, 0);  // green = running
  goToPage(0);
}

void loop() {
  if (upButton.pressed()) {
    autoAdvance = false;
    goToPage(page + 1);
  }
  if (downButton.pressed()) {
    autoAdvance = false;
    goToPage(page - 1);
  }
  if (autoAdvance && millis() - pageStartedMs > kAutoAdvanceMs) goToPage(page + 1);

  drawPage();
  delay(16);  // ~60 fps redraw
}
