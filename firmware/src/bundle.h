// Parser for the TKB1 bundle described in docs/protocol.md.
//
// A Bundle points into one raw byte buffer (allocated in PSRAM). Pixel data
// is left in place as little-endian bytes and read with px(); it can sit at
// odd offsets, so it must never be cast to uint16_t*.
#pragma once
#include <Arduino.h>

constexpr int kMaxScreens = 16;
constexpr int kBundleHeaderBytes = 24;

// Header flag bits
constexpr uint8_t kFlagStale = 1 << 0;
constexpr uint8_t kFlagMarketOpen = 1 << 1;
constexpr uint8_t kFlagDoubleTap = 1 << 2;
constexpr uint8_t kFlag24h = 1 << 3;

struct Screen {
  char id[33];
  uint8_t clockX, clockY;  // clockX == 255 -> no clock
  uint16_t clockColor;
  uint8_t stripY, stripH;  // stripH == 0 -> no strip
  uint16_t stripW;
  uint8_t scrollSpeed;     // px per second
  const uint8_t* bg;       // 64*32 RGB565 LE
  const uint8_t* strip;    // stripW*stripH RGB565 LE (nullptr if none)
};

struct Bundle {
  uint8_t* data = nullptr;  // owned raw bytes (free with freeBundle)
  size_t size = 0;
  uint32_t crc = 0;         // of the raw bytes, to detect changes

  uint8_t screenCount = 0;
  uint16_t pollSeconds = 60;
  uint8_t brightness = 128;
  uint8_t flags = 0;
  uint16_t dwellSeconds = 0;
  uint32_t serverTime = 0;
  int16_t utcOffsetMin = 0;
  Screen screens[kMaxScreens];

  uint32_t fetchedAtMs = 0; // millis() when received
  bool fromCache = false;   // loaded from flash at boot: time and freshness unknown
};

// Reads pixel i (0-based) from an RGB565 little-endian byte array.
inline uint16_t px(const uint8_t* p, size_t i) { return p[2 * i] | (p[2 * i + 1] << 8); }

// Validates and indexes `data`. On success `out` takes ownership of `data`.
// On failure returns false, `out` is untouched and the caller still owns `data`.
bool parseBundle(uint8_t* data, size_t size, Bundle& out, String& error);

// Frees the bundle's buffer and resets it.
void freeBundle(Bundle* b);
