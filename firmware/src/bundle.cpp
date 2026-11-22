#include "bundle.h"

#include <esp_rom_crc.h>

namespace {

// Little-endian cursor that never reads past the end.
struct Reader {
  const uint8_t* p;
  size_t size, pos = 0;
  bool ok = true;

  bool need(size_t n) {
    if (!ok || pos + n > size) ok = false;
    return ok;
  }
  uint8_t u8() { return need(1) ? p[pos++] : 0; }
  uint16_t u16() {
    if (!need(2)) return 0;
    uint16_t v = p[pos] | (p[pos + 1] << 8);
    pos += 2;
    return v;
  }
  uint32_t u32() {
    if (!need(4)) return 0;
    uint32_t v = p[pos] | (p[pos + 1] << 8) | (p[pos + 2] << 16) | ((uint32_t)p[pos + 3] << 24);
    pos += 4;
    return v;
  }
  const uint8_t* bytes(size_t n) {
    if (!need(n)) return nullptr;
    const uint8_t* r = p + pos;
    pos += n;
    return r;
  }
};

}  // namespace

bool parseBundle(uint8_t* data, size_t size, Bundle& out, String& error) {
  Reader r{data, size};
  Bundle b;

  const uint8_t* magic = r.bytes(4);
  if (!magic || memcmp(magic, "TKB1", 4) != 0) { error = "bad magic"; return false; }
  uint8_t version = r.u8();
  if (version != 1) { error = "unsupported version " + String(version); return false; }
  b.screenCount = r.u8();
  b.pollSeconds = r.u16();
  b.brightness = r.u8();
  b.flags = r.u8();
  b.dwellSeconds = r.u16();
  b.serverTime = r.u32();
  b.utcOffsetMin = (int16_t)r.u16();
  r.bytes(6);  // reserved
  if (!r.ok) { error = "short header"; return false; }
  if (b.screenCount == 0 || b.screenCount > kMaxScreens) {
    error = "bad screen count " + String(b.screenCount);
    return false;
  }
  if (b.pollSeconds < 10) b.pollSeconds = 10;  // protect the server from a bad value

  for (int i = 0; i < b.screenCount; i++) {
    Screen& s = b.screens[i];
    uint8_t idLen = r.u8();
    const uint8_t* id = r.bytes(idLen);
    if (!r.ok) break;
    size_t n = min<size_t>(idLen, sizeof(s.id) - 1);
    memcpy(s.id, id, n);
    s.id[n] = 0;
    s.clockX = r.u8();
    s.clockY = r.u8();
    s.clockColor = r.u16();
    s.stripY = r.u8();
    s.stripH = r.u8();
    s.stripW = r.u16();
    s.scrollSpeed = r.u8();
    r.u8();  // reserved
    s.bg = r.bytes(64 * 32 * 2);
    s.strip = nullptr;
    if (s.stripH > 0) {
      if (s.stripW == 0 || s.stripY + s.stripH > 32) {
        error = "bad strip on screen " + String(i);
        return false;
      }
      s.strip = r.bytes((size_t)s.stripW * s.stripH * 2);
    }
    if (s.clockX != 255 && (s.clockX > 63 || s.clockY > 27)) s.clockX = 255;  // ignore off-screen clock
  }
  if (!r.ok) { error = "truncated screens"; return false; }
  if (r.pos != size) { error = "trailing bytes"; return false; }

  b.data = data;
  b.size = size;
  b.crc = esp_rom_crc32_le(0, data, size);
  // The 24-byte header carries the server time, which changes on every fetch;
  // the screens after it only change when the content does.
  b.contentCrc = esp_rom_crc32_le(0, data + kBundleHeaderBytes, size - kBundleHeaderBytes);
  out = b;
  return true;
}

void freeBundle(Bundle* b) {
  if (!b) return;
  free(b->data);
  b->data = nullptr;
  b->size = 0;
  b->screenCount = 0;
}
