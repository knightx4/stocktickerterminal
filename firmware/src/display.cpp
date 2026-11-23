#include "display.h"

#include <Adafruit_Protomatter.h>

#include "board.h"
#include "fm6126a.h"

namespace {

// 6 bit planes for smoother dimming; double-buffered so frames never tear.
Adafruit_Protomatter matrix(board::kWidth, 6, 1, board::rgbPins, 4, board::addrPins,
                            board::kClockPin, board::kLatchPin, board::kOePin, true);

// ---------------------------------------------------------------- brightness
// Protomatter has no brightness control, so every RGB565 pixel goes through
// these lookup tables. Channels are scaled and rounded independently, so a
// colour keeps its hue when dimmed. If a pixel that was meant to be clearly
// visible (text, at night) would vanish, its strongest channel stays lit at
// the lowest step. Dark pixels (photo backgrounds) are allowed to go black:
// lighting them showed up as stray red/green specks.
uint8_t lutBrightness = 255;
uint8_t lut5[32], lut6[64];

void buildLut(uint8_t brightness) {
  if (brightness == lutBrightness && lut5[31]) return;
  lutBrightness = brightness;
  for (int i = 0; i < 32; i++) lut5[i] = (i * brightness + 127) / 255;
  for (int i = 0; i < 64; i++) lut6[i] = (i * brightness + 127) / 255;
}

inline uint16_t scale(uint16_t c) {
  if (!c || !lutBrightness) return 0;
  uint8_t r = c >> 11, g = (c >> 5) & 0x3F, b = c & 0x1F;
  uint8_t sr = lut5[r], sg = lut6[g], sb = lut5[b];
  bool meantToBeSeen = r >= 16 || g >= 32 || b >= 16;  // a channel at half strength or more
  if (!(sr | sg | sb) && meantToBeSeen) {
    uint8_t g5 = g >> 1;  // compare green at 5-bit scale
    if (r >= g5 && r >= b) sr = 1;
    else if (g5 >= b) sg = 1;
    else sb = 1;
  }
  return (sr << 11) | (sg << 5) | sb;
}

// ---------------------------------------------------------------- clock font
// 3x5 digits from docs/protocol.md. Each glyph is 5 rows of 3 bits (MSB = left).
const uint8_t kDigits[10][5] = {
    {7, 5, 5, 5, 7}, {2, 6, 2, 2, 7}, {7, 1, 7, 4, 7}, {7, 1, 7, 1, 7}, {5, 5, 7, 1, 1},
    {7, 4, 7, 1, 7}, {7, 4, 7, 5, 7}, {7, 1, 1, 1, 1}, {7, 5, 7, 5, 7}, {7, 5, 7, 1, 7},
};

inline void setPx(uint16_t* buf, int x, int y, uint16_t c) {
  if (x >= 0 && x < board::kWidth && y >= 0 && y < board::kHeight) buf[y * board::kWidth + x] = c;
}

// Draws "H:MM" (or "HH:MM") with its rightmost column at `right`.
void drawClock(uint16_t* buf, int right, int top, int hours, int minutes, uint16_t color) {
  char s[6];
  snprintf(s, sizeof s, "%d:%02d", hours, minutes);
  int width = 0;
  for (char* p = s; *p; p++) width += (*p == ':' ? 1 : 3) + (p[1] ? 1 : 0);
  int x = right - width + 1;
  for (char* p = s; *p; p++) {
    if (*p == ':') {
      setPx(buf, x, top + 1, color);
      setPx(buf, x, top + 3, color);
      x += 2;
      continue;
    }
    const uint8_t* g = kDigits[*p - '0'];
    for (int row = 0; row < 5; row++)
      for (int col = 0; col < 3; col++)
        if (g[row] & (4 >> col)) setPx(buf, x + col, top + row, color);
    x += 4;
  }
}

}  // namespace

bool displayBegin(bool fm6126a) {
  if (fm6126a) fm6126aInit();
  ProtomatterStatus status = matrix.begin();
  Serial.printf("[display] Protomatter begin: %d (0 = OK)\n", (int)status);
  matrix.setTextWrap(false);
  buildLut(255);
  return status == PROTOMATTER_OK;
}

void displayScreen(const Bundle& b, int index, uint32_t scrollMs, int32_t localTime,
                   StatusLight status) {
  if (index < 0 || index >= b.screenCount) return;
  const Screen& s = b.screens[index];
  buildLut(b.brightness);
  uint16_t* buf = matrix.getBuffer();

  uint32_t offset = 0;
  if (s.stripH && s.scrollSpeed) offset = (uint64_t)scrollMs * s.scrollSpeed / 1000 % s.stripW;

  for (int y = 0; y < board::kHeight; y++) {
    uint16_t* row = buf + y * board::kWidth;
    bool inStrip = s.stripH && y >= s.stripY && y < s.stripY + s.stripH;
    if (inStrip) {
      size_t base = (size_t)(y - s.stripY) * s.stripW;
      uint32_t col = offset;
      for (int x = 0; x < board::kWidth; x++) {
        row[x] = scale(px(s.strip, base + col));
        if (++col >= s.stripW) col = 0;
      }
    } else {
      size_t base = (size_t)y * board::kWidth;
      for (int x = 0; x < board::kWidth; x++) row[x] = scale(px(s.bg, base + x));
    }
  }

  if (s.clockX != 255 && localTime >= 0) {
    int h = localTime / 3600 % 24, m = localTime / 60 % 60;
    if (!(b.flags & kFlag24h)) h = h % 12 == 0 ? 12 : h % 12;
    drawClock(buf, s.clockX, s.clockY, h, m, scale(s.clockColor));
  }

  if (status != StatusLight::None) {
    uint16_t c = status == StatusLight::Amber ? matrix.color565(255, 140, 0) : matrix.color565(255, 0, 0);
    buf[board::kWidth * board::kHeight - 1] = scale(c);
  }
  matrix.show();
}

void displayAnimation(const Animation& a, uint32_t ms, uint8_t brightness) {
  buildLut(brightness);
  animationFrame(a, ms, matrix.getBuffer(), scale);
  matrix.show();
}

void displayText(const char* l1, const char* l2, const char* l3, const char* l4,
                 uint8_t brightness) {
  buildLut(brightness);
  matrix.fillScreen(0);
  const char* lines[] = {l1, l2, l3, l4};
  const uint16_t colors[] = {matrix.color565(255, 160, 0), matrix.color565(220, 220, 220),
                             matrix.color565(0, 200, 255), matrix.color565(0, 200, 255)};
  for (int i = 0; i < 4; i++) {
    matrix.setCursor(1, i * 8);
    matrix.setTextColor(scale(colors[i]));
    matrix.print(lines[i]);
  }
  matrix.show();
}
