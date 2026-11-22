// Pin map for the Adafruit Matrix Portal S3 driving one 64x32 HUB75 panel.
// HUB75 pins come from Adafruit's Protomatter examples for this board.
#pragma once
#include <Arduino.h>

namespace board {

constexpr uint16_t kWidth = 64;
constexpr uint16_t kHeight = 32;

// HUB75 connector: R1 G1 B1 R2 G2 B2
inline uint8_t rgbPins[] = {42, 41, 40, 38, 39, 37};
// Row address lines A B C D (a 32-row, 1/16-scan panel needs 4; E=21 is for 64-row panels)
inline uint8_t addrPins[] = {45, 36, 48, 35};
constexpr uint8_t kClockPin = 2;
constexpr uint8_t kLatchPin = 47;
constexpr uint8_t kOePin = 14;

// Board extras
constexpr uint8_t kButtonUp = PIN_BUTTON_UP;      // GPIO 6, active low, no external pull-up
constexpr uint8_t kButtonDown = PIN_BUTTON_DOWN;  // GPIO 7, active low, no external pull-up
constexpr uint8_t kNeoPixel = PIN_NEOPIXEL;       // GPIO 4
constexpr uint8_t kLightSensor = PIN_LIGHTSENSOR; // A5 / GPIO 5, for auto-dim later
constexpr uint8_t kAccelAddr = 0x19;              // LIS3DH (not the 0x18 library default)

}  // namespace board
