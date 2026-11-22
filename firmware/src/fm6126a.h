// Some HUB75 panels use FM6126A driver chips, which stay dark until two
// configuration registers are written. Protomatter does not do this, so we
// do it once at boot, before the display starts.
//
// Ported from the FM6124/FM6126A init in mrfaptastic's
// ESP32-HUB75-MatrixPanel-DMA library (MIT licence).
#pragma once
#include <Arduino.h>
#include "board.h"

inline void fm6126aInit() {
  const bool REG1[16] = {0,0,0,0,0, 1,1,1,1,1,1, 0,0,0,0,0};  // brightness / current
  const bool REG2[16] = {0,0,0,0,0, 0,0,0,0,1,0, 0,0,0,0,0};  // output enable

  for (uint8_t p : board::rgbPins) pinMode(p, OUTPUT), digitalWrite(p, LOW);
  pinMode(board::kClockPin, OUTPUT); digitalWrite(board::kClockPin, LOW);
  pinMode(board::kLatchPin, OUTPUT); digitalWrite(board::kLatchPin, LOW);
  pinMode(board::kOePin, OUTPUT);    digitalWrite(board::kOePin, HIGH);  // display off

  auto writeReg = [](const bool* reg, int latchClocks) {
    const int n = board::kWidth;
    for (int i = 0; i < n; i++) {
      for (uint8_t p : board::rgbPins) digitalWrite(p, reg[i % 16]);
      if (i >= n - latchClocks) digitalWrite(board::kLatchPin, HIGH);
      digitalWrite(board::kClockPin, HIGH);
      digitalWrite(board::kClockPin, LOW);
    }
    digitalWrite(board::kLatchPin, LOW);
  };
  writeReg(REG1, 11);
  writeReg(REG2, 12);

  for (uint8_t p : board::rgbPins) digitalWrite(p, LOW);
}
