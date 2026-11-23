// Desktop test for the firmware's animation code (anim.cpp).
// Usage: anim_host_test <file.tka> <expected-crc-hex> <dump.bin>
// Writes frames at fixed times as raw RGB565 to dump.bin for comparison with
// the server's decoder.
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "../src/anim.h"

static uint16_t identity(uint16_t c) { return c; }

int main(int argc, char** argv) {
  FILE* f = fopen(argv[1], "rb");
  assert(f);
  std::vector<uint8_t> d;
  int c;
  while ((c = fgetc(f)) != EOF) d.push_back((uint8_t)c);
  fclose(f);

  uint32_t crc = crc32Of(d.data(), d.size());
  uint32_t want = strtoul(argv[2], nullptr, 16);
  printf("crc32 %08x (server %08x) %s\n", crc, want, crc == want ? "OK" : "MISMATCH");
  if (crc != want) return 1;

  // Truncated copies must be rejected without crashing.
  for (size_t cut : {d.size() - 1, d.size() / 2, (size_t)20, (size_t)3}) {
    uint8_t* p = (uint8_t*)malloc(cut);
    memcpy(p, d.data(), cut);
    Animation a;
    String err;
    assert(!parseAnimation(p, cut, a, err));
    free(p);
  }

  uint8_t* p = (uint8_t*)malloc(d.size());
  memcpy(p, d.data(), d.size());
  Animation a;
  String err;
  if (!parseAnimation(p, d.size(), a, err)) { printf("parse failed: %s\n", err.c_str()); return 1; }
  printf("frames %u, total %u ms\n", a.count, (unsigned)a.totalMs);

  FILE* out = fopen(argv[3], "wb");
  uint16_t frame[2048];
  for (uint32_t ms : {0u, 3000u, 8000u, 15000u, 25000u, 33000u, 35771u, 35772u + 100u}) {
    animationFrame(a, ms, frame, identity);
    fwrite(frame, 2, 2048, out);  // host is little-endian
  }
  fclose(out);
  freeAnimation(&a);
  printf("anim host test: OK\n");
  return 0;
}
