#include "input.h"

#include <Wire.h>

#include "board.h"

namespace {

struct Button {
  uint8_t pin;
  bool lastDown = false;
  uint32_t lastChangeMs = 0;

  bool pressed() {  // true once per press, debounced
    bool down = digitalRead(pin) == LOW;
    uint32_t now = millis();
    if (down != lastDown && now - lastChangeMs > 30) {
      lastDown = down;
      lastChangeMs = now;
      return down;
    }
    return false;
  }
};

Button up{board::kButtonUp};
Button down{board::kButtonDown};

// LIS3DH registers
constexpr uint8_t kWhoAmI = 0x0F, kCtrl1 = 0x20, kCtrl4 = 0x23;
constexpr uint8_t kClickCfg = 0x38, kClickSrc = 0x39, kClickThs = 0x3A;
constexpr uint8_t kTimeLimit = 0x3B, kTimeLatency = 0x3C, kTimeWindow = 0x3D;

// Tap sensitivity. Lower = more sensitive (1 LSB = 16 mg at +/-2 g).
// Tune on the real case: too low and typing on the desk triggers it.
constexpr uint8_t kTapThreshold = 80;

bool accelOk = false;
uint32_t lastAccelPollMs = 0, lastTapMs = 0, lastButtonMs = 0;

bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(board::kAccelAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

int readReg(uint8_t reg) {
  Wire.beginTransmission(board::kAccelAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(board::kAccelAddr, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

void accelBegin() {
  Wire.begin();
  Wire.setTimeOut(20);
  if (readReg(kWhoAmI) != 0x33) {
    Serial.println("[input] LIS3DH not found at 0x19; double-tap disabled");
    return;
  }
  accelOk = writeReg(kCtrl1, 0x77)                // 400 Hz, X/Y/Z on
            && writeReg(kCtrl4, 0x88)             // block update, high-res, +/-2 g
            && writeReg(kClickCfg, 0x2A)          // double-click on X, Y, Z
            && writeReg(kClickThs, 0x80 | kTapThreshold)  // latch until CLICK_SRC is read
            && writeReg(kTimeLimit, 10)
            && writeReg(kTimeLatency, 20)
            && writeReg(kTimeWindow, 255);
  Serial.printf("[input] LIS3DH double-tap %s\n", accelOk ? "ready" : "init failed");
}

}  // namespace

void inputBegin() {
  pinMode(board::kButtonUp, INPUT_PULLUP);
  pinMode(board::kButtonDown, INPUT_PULLUP);
  accelBegin();
}

bool upHeld() { return digitalRead(board::kButtonUp) == LOW; }

InputEvent inputPoll() {
  uint32_t now = millis();
  if (up.pressed()) { lastButtonMs = now; return InputEvent::Next; }
  if (down.pressed()) { lastButtonMs = now; return InputEvent::Previous; }

  if (accelOk && now - lastAccelPollMs >= 20) {  // ~50 Hz
    lastAccelPollMs = now;
    int src = readReg(kClickSrc);
    bool doubleTap = src > 0 && (src & 0x40) && (src & 0x20);  // IA + DClick
    // Ignore taps right after a button press (pressing shakes the case)
    // and repeat triggers from the same tap.
    if (doubleTap && now - lastButtonMs > 1000 && now - lastTapMs > 700) {
      lastTapMs = now;
      return InputEvent::Tap;
    }
  }
  return InputEvent::None;
}
