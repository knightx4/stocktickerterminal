// Animations (TKA1, see docs/protocol.md), e.g. the birthday sequence.
// Downloaded once into PSRAM and played from there. Not saved to flash:
// flash writes glitch the panel, and re-downloading after a reboot is cheap.
#pragma once
#include <Arduino.h>

struct Animation {
  uint8_t* data = nullptr;      // owned raw TKA1 bytes (free with freeAnimation)
  size_t size = 0;
  uint32_t crc = 0;             // CRC-32 of data, matches the bundle's asset_crc
  uint16_t count = 0;           // frames
  uint32_t totalMs = 0;         // one loop
  uint32_t* offsets = nullptr;  // byte offset of each frame's header
  uint32_t* starts = nullptr;   // start time of each frame, ms
  char id[17] = "";
};

// Standard CRC-32 (same as zlib's crc32), so it matches the server.
uint32_t crc32Of(const uint8_t* data, size_t len);

// Validates and indexes `data`. On success `out` takes ownership of `data`.
bool parseAnimation(uint8_t* data, size_t size, Animation& out, String& error);

void freeAnimation(Animation* a);

// Decodes the frame showing at `ms` (looping) into 2048 RGB565 pixels,
// passing each through `map` (e.g. the brightness scaler).
void animationFrame(const Animation& a, uint32_t ms, uint16_t* out, uint16_t (*map)(uint16_t));
