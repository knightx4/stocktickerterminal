// Buttons (UP/DOWN) and double-tap on the case (LIS3DH accelerometer).
#pragma once
#include <Arduino.h>

enum class InputEvent { None, Next, Previous, Tap };

void inputBegin();

// Call every loop. Returns at most one event per call.
InputEvent inputPoll();

// True while UP is held (checked at boot to force the Wi-Fi portal).
bool upHeld();
