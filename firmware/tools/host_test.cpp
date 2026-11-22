// Desktop test for the firmware's bundle parser. Run: ./run_host_test.sh
#include <cassert>
#include <cstdio>
#include <vector>

#include "../src/bundle.h"

static std::vector<uint8_t> readFile(const char* path) {
  FILE* f = fopen(path, "rb");
  assert(f);
  std::vector<uint8_t> d;
  int c;
  while ((c = fgetc(f)) != EOF) d.push_back((uint8_t)c);
  fclose(f);
  return d;
}

static uint8_t* copyOf(const std::vector<uint8_t>& v, size_t n) {
  uint8_t* p = (uint8_t*)malloc(n);
  memcpy(p, v.data(), n);
  return p;
}

int main(int argc, char** argv) {
  auto file = readFile(argv[1]);
  Bundle b;
  String err;
  uint8_t* data = copyOf(file, file.size());
  bool ok = parseBundle(data, file.size(), b, err);
  if (!ok) { printf("parse failed: %s\n", err.c_str()); return 1; }
  assert(b.screenCount == 2 && b.pollSeconds == 60 && b.brightness == 200);
  assert(b.flags == 0b0110 && b.dwellSeconds == 8 && b.serverTime == 1795000000u);
  assert(b.utcOffsetMin == -360);
  const Screen& t = b.screens[0];
  assert(!strcmp(t.id, "ticker") && t.clockX == 63 && t.clockY == 1);
  assert(t.stripY == 12 && t.stripH == 9 && t.stripW == 100 && t.scrollSpeed == 30);
  assert(px(t.bg, 0) == 0xF800 && px(t.bg, 2047) == 0xF800 && px(t.strip, 899) == 0x001F);
  const Screen& s = b.screens[1];
  assert(!strcmp(s.id, "since1968") && s.clockX == 255 && s.stripH == 0 && !s.strip);
  assert(px(s.bg, 1000) == 0x07E0);
  freeBundle(&b);

  // Every truncation must be rejected, never read out of bounds.
  for (size_t n = 0; n < file.size(); n += (n < 64 ? 1 : 97)) {
    Bundle t2;
    uint8_t* d = copyOf(file, n);
    assert(!parseBundle(d, n, t2, err));
    free(d);
  }
  // Trailing junk is rejected too.
  {
    std::vector<uint8_t> longer = file;
    longer.push_back(0);
    Bundle t3;
    uint8_t* d = copyOf(longer, longer.size());
    assert(!parseBundle(d, longer.size(), t3, err) && err == "trailing bytes");
    free(d);
  }
  printf("host_test: all bundle parser checks passed\n");
  return 0;
}
