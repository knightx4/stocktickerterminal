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
