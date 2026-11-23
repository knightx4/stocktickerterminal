// Everything that draws on the LED panel.
#pragma once
#include <Arduino.h>

#include "anim.h"
#include "bundle.h"

enum class StatusLight { None, Amber, Red };

// Starts the panel. fm6126a: send the FM6126A init first (see fm6126a.h).
bool displayBegin(bool fm6126a);

// Draws one screen of a bundle: background, scrolling strip, clock, status pixel.
// scrollMs: how long this screen has been showing (drives the strip offset).
// localTime: seconds since midnight local time, or -1 to hide the clock.
void displayScreen(const Bundle& b, int index, uint32_t scrollMs, int32_t localTime,
                   StatusLight status);

// Draws the frame of an animation showing `ms` into it (looping).
void displayAnimation(const Animation& a, uint32_t ms, uint8_t brightness);

// Plain text screen for setup and error states. Up to 4 lines of 10 chars.
void displayText(const char* l1, const char* l2 = "", const char* l3 = "", const char* l4 = "",
                 uint8_t brightness = 100);
