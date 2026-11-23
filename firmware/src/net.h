// Networking: Wi-Fi (with setup portal), bundle fetching, and the flash
// cache. Everything here runs in one FreeRTOS task on core 0 so the display
// loop on core 1 never waits on the network.
#pragma once
#include <Arduino.h>

#include "anim.h"
#include "bundle.h"

// Read-mostly status shared with the display loop.
struct NetStatus {
  volatile bool connected = false;
  volatile bool portalActive = false;
  volatile bool updating = false;         // OTA in progress
  volatile uint32_t lastSuccessMs = 0;    // millis() of last good bundle; 0 = none this boot
  volatile uint32_t bootMs = 0;
};
extern NetStatus netStatus;

// Loads the cached bundle from flash (if any). Call before the display starts:
// reading flash while the panel is refreshing garbles it for a moment.
void netInit();

// Starts the network task. forcePortal: open the Wi-Fi setup portal right away
// (UP held at boot).
void netBegin(bool forcePortal);

// The current bundle, or nullptr. Hold the lock while using it.
Bundle* lockBundle();
void unlockBundle();

// The downloaded animation, or nullptr. Only valid while the bundle lock is held.
const Animation* lockedAnimation();

// Last error text, for the heartbeat.
String netLastError();
