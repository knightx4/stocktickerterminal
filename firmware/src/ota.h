// Heartbeat to the server and over-the-air firmware updates.
// See "POST /api/ping" in docs/protocol.md.
#pragma once

// Sends the heartbeat. If the server offers newer firmware, downloads it,
// checks its MD5 and reboots into it. Called from the network task.
void sendPingAndMaybeUpdate();

// Set by main.cpp so the heartbeat can report which screen is showing.
extern volatile const char* currentScreenId;
