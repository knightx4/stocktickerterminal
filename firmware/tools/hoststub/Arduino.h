// Minimal stand-ins so bundle.cpp compiles on a desktop for tools/host_test.cpp.
#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
using std::min;
using std::max;
struct String : std::string {
  String() = default;
  String(const char* s) : std::string(s) {}
  String(const std::string& s) : std::string(s) {}
  explicit String(int v) : std::string(std::to_string(v)) {}
};
inline String operator+(const char* a, const String& b) { return String(std::string(a) + b); }
inline String operator+(const String& a, const String& b) { return String(std::string(a) + std::string(b)); }
inline void* ps_malloc(size_t n) { return malloc(n); }
inline size_t strlcpy(char* d, const char* s, size_t n) { size_t l = strlen(s); if (n) { size_t c = l < n - 1 ? l : n - 1; memcpy(d, s, c); d[c] = 0; } return l; }
