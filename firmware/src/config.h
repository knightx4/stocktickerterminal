// Settings you may need to change. Everything else lives on the server.
#pragma once
#include <stdint.h>

// ---- Fill these in before flashing -------------------------------------
// Base URL of the Vercel deployment (no trailing slash).
#define SERVER_URL "https://dad-ticker-blush.vercel.app"
// DEVICE_TOKEN lives in secrets.h, which is gitignored because this repo is
// public. Copy secrets.example.h to secrets.h and paste in the token.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing firmware/src/secrets.h - copy secrets.example.h to secrets.h and fill it in"
#endif

// Bump this for every firmware release you publish for OTA. The server's
// /api/ping tells the device about newer versions; it only updates upward.
#define FW_VERSION 4

// ---- Timing (rarely need changing) ---------------------------------------
namespace cfg {
constexpr uint32_t kHttpTimeoutMs = 10000;            // connect + read timeout
constexpr uint32_t kPingIntervalMs = 5UL * 60 * 1000; // heartbeat / OTA check
constexpr uint32_t kSaveIntervalMs = 60UL * 60 * 1000; // max flash write rate for cached bundle
constexpr uint8_t kSaveMaxBrightness = 64;            // only save while dimmed (night); flash writes glitch the panel
constexpr uint32_t kRetryMinMs = 15000;               // first retry after a failed fetch
constexpr uint32_t kDefaultPollMs = 60000;            // until the server tells us otherwise
constexpr uint32_t kOfflineBeforePortalMs = 10UL * 60 * 1000; // disconnected this long -> open portal
constexpr uint32_t kPortalOpenSeconds = 300;          // portal stays up this long (unless a phone is connected)
constexpr uint32_t kButtonPauseMs = 60000;            // a button press pauses auto-advance this long
constexpr uint32_t kWatchdogMs = 30000;               // reboot if a task hangs this long
constexpr uint32_t kRedOfflineMs = 30UL * 60 * 1000;  // status pixel turns red after this long without data
constexpr size_t kMaxBundleBytes = 512 * 1024;        // sanity cap (bundles are ~30-150 KB)
constexpr const char* kPortalName = "Ticker-Setup";
}  // namespace cfg
