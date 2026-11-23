#include "anim.h"

namespace {
inline uint16_t rd16(const uint8_t* p) { return p[0] | (p[1] << 8); }
inline uint32_t rd32(const uint8_t* p) {
  return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
}
constexpr size_t kHeader = 14;  // "TKA1", w, h, count, total_ms
}  // namespace

uint32_t crc32Of(const uint8_t* data, size_t len) {
  static uint32_t table[256];
  static bool ready = false;
  if (!ready) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[i] = c;
    }
    ready = true;
  }
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}

bool parseAnimation(uint8_t* data, size_t size, Animation& out, String& error) {
  if (size < kHeader || memcmp(data, "TKA1", 4) != 0) { error = "not TKA1"; return false; }
  if (rd16(data + 4) != 64 || rd16(data + 6) != 32) { error = "not 64x32"; return false; }
  uint16_t count = rd16(data + 8);
  if (count == 0) { error = "no frames"; return false; }

  uint32_t* offsets = (uint32_t*)ps_malloc(count * sizeof(uint32_t));
  uint32_t* starts = (uint32_t*)ps_malloc(count * sizeof(uint32_t));
  if (!offsets || !starts) { free(offsets); free(starts); error = "out of memory"; return false; }

  size_t o = kHeader;
  uint32_t t = 0;
  for (uint16_t i = 0; i < count; i++) {
    if (o + 5 > size) { error = "truncated frame " + String(i); break; }
    uint16_t ms = rd16(data + o);
    uint8_t enc = data[o + 2];
    uint16_t len = rd16(data + o + 3);
    bool lenOk = enc == 0 ? len == 4096 : enc == 1 ? len % 3 == 0 : false;
    if (!lenOk || o + 5 + len > size) { error = "bad frame " + String(i); break; }
    offsets[i] = o;
    starts[i] = t;
    t += ms;
    o += 5 + len;
  }
  if (error.length() == 0 && o != size) error = "trailing bytes";
  if (error.length() == 0 && t == 0) error = "zero duration";
  if (error.length()) { free(offsets); free(starts); return false; }

  out.data = data;
  out.size = size;
  out.count = count;
  out.totalMs = t;
  out.offsets = offsets;
  out.starts = starts;
  return true;
}

void freeAnimation(Animation* a) {
  if (!a) return;
  free(a->data);
  free(a->offsets);
  free(a->starts);
  a->data = nullptr;
  a->offsets = a->starts = nullptr;
  a->count = 0;
}

void animationFrame(const Animation& a, uint32_t ms, uint16_t* out, uint16_t (*map)(uint16_t)) {
  uint32_t t = ms % a.totalMs;
  // binary search for the last frame starting at or before t
  int lo = 0, hi = a.count - 1;
  while (lo < hi) {
    int mid = (lo + hi + 1) / 2;
    if (a.starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const uint8_t* f = a.data + a.offsets[lo];
  uint8_t enc = f[2];
  uint16_t len = rd16(f + 3);
  const uint8_t* p = f + 5;
  if (enc == 0) {
    for (int i = 0; i < 2048; i++) out[i] = map(rd16(p + 2 * i));
    return;
  }
  int n = 0;
  for (const uint8_t* q = p; q + 3 <= p + len && n < 2048; q += 3) {
    uint16_t c = map(rd16(q + 1));
    for (int k = 0; k < q[0] && n < 2048; k++) out[n++] = c;
  }
  while (n < 2048) out[n++] = 0;  // malformed short frame: blank the rest
}
