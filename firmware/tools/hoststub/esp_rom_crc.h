#pragma once
#include <cstddef>
#include <cstdint>
inline uint32_t esp_rom_crc32_le(uint32_t crc, const uint8_t* p, size_t n) {
  crc = ~crc;
  while (n--) { crc ^= *p++; for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return ~crc;
}
