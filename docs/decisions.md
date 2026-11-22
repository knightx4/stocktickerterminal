# Design decisions

Decided 2026-11-22. Each section gives the choice, then the reason.

## 1. Stock list: a Google Sheet

One sheet, shared with Dad, published to the web as CSV. The server reads the
CSV and caches it for 5 minutes.

- Both of you can edit it from a phone, and he already knows spreadsheets.
- No login code, no database, and no edit page to build or secure.
- Later screens fit as extra tabs: `symbols`, `message` (birthday notes),
  `firm` (the manually entered progress numbers).
- If the sheet is unreachable or a row is malformed, the server keeps using the
  last good copy.

The only data it exposes is a list of tickers. A custom edit page can come
later if the sheet feels clunky.

## 2. Market data: Finnhub, plus FRED for indices and history

| Need | Source | Why |
|---|---|---|
| Stock and ETF quotes (price, % change) | **Finnhub** free tier | About 60 calls/min, real-time US quotes, official API |
| Index % change for the day | ETF proxies on Finnhub: SPY, DIA, QQQ | True index quotes (^GSPC etc.) are paid on every free tier we checked |
| Index levels (S&P 500, Dow, Nasdaq) | **FRED** series `SP500`, `DJIA`, `NASDAQCOM` | Free official API, daily closes, roughly the last 10 years |
| S&P 500 since 1968 | Shiller monthly dataset (Yale), saved as a static JSON file, joined to FRED for recent years | No free API covers 1968 daily. History never changes, so we store it once |
| Fallback quotes | **Twelve Data** free tier (800 credits/day, 8/min) | Different provider, so one outage doesn't take out both |

Others, rejected:
- **Alpha Vantage**: the free tier allows 25 requests per day, which is too few.
- **Polygon/Massive**: the free tier gives end-of-day data at 5 calls/min.
- **Yahoo Finance**: an unofficial API that breaks without warning.

Free-tier limits change often. Check them with real keys in milestone 3. The
Finnhub and Vercel Hobby free tiers are for personal or non-commercial use.
A gift on his desk at home fits that. Don't use it for client-facing work at
his firm.

On the index screen, the day's % change comes from the ETF (it stays within a
few hundredths of a percent of the index). The level shown is the previous
FRED close, marked as such, so he never sees an incorrect index level.

## 3. Hosting: Vercel serverless functions with CDN caching

- `GET /api/frame?screen=ticker&t=<device token>` returns a ready-to-draw frame.
- Responses send `Cache-Control: s-maxage=60, stale-while-revalidate=600`.
  Vercel's CDN then answers most requests, the function runs at most about
  once a minute per screen, and the device never calls a market API directly.
- If an upstream API fails, the function serves the last good data (from the
  CDN or a small Vercel Blob / Edge Config cache) and marks it stale.
- API keys live only in Vercel environment variables.

## 4. Firmware: Arduino (PlatformIO) with Adafruit Protomatter

- **Arduino rather than CircuitPython**: it has real OTA with dual app slots and
  automatic rollback, a hardware watchdog, and a mature captive-portal Wi-Fi
  library (WiFiManager). CircuitPython has no safe way to update itself.
- **Protomatter rather than ESP32-HUB75-MatrixPanel-DMA**: the DMA library's
  own README warns that it causes Wi-Fi radio problems on the Matrix Portal S3.
  For a device that lives on Wi-Fi, that settles it. Protomatter is Adafruit's
  own driver for this board.
- Protomatter has no FM6126A support, so `firmware/src/fm6126a.h` writes the
  two FM6126A registers itself at boot (ported from the DMA library).
- Protomatter has no brightness control either, so the firmware scales colors.

The device stays a thin client, so the firmware is small and should rarely
need changing.

## 5. Remote updates

- **Screens, stocks, layout, schedule, brightness**: change the server and
  redeploy, or edit the sheet. No firmware change needed.
- **Firmware**: once a day (and on boot) the device fetches
  `/api/firmware?t=<token>`, which returns `{version, url, sha256}`. If the
  version is newer, it downloads the image into the inactive OTA slot, checks
  the hash, and reboots. The new image marks itself valid only after it has
  fetched a frame successfully. If it doesn't, the bootloader rolls back to the
  old image on the next reset. Firmware images are hosted as GitHub Release
  assets or Vercel static files.
- The partition table needs two app slots of about 3 MB each (8 MB flash).
  This gets set up in milestone 5.

## 6. Wi-Fi setup: captive portal (WiFiManager)

- On first boot, or after 5 minutes without reaching any saved network, the
  device starts an access point called `Ticker-Setup`. The panel shows
  "Join Wi-Fi: Ticker-Setup". From a phone, he picks his network and enters
  the password.
- Holding UP while pressing Reset forces setup mode.
- While setup mode runs, it keeps retrying the saved network in the background,
  so a router reboot doesn't strand the device in setup.
- Optionally, preload his credentials at build time so it works out of the box.

## 7. Behavior

The schedule is decided by the server, which sends a "next poll in N seconds"
value with each frame, so it can be retuned without firmware changes.

| Period (Eastern time) | Poll interval |
|---|---|
| Regular session, 9:30-16:00 | 60 s |
| Pre-market 4:00-9:30 and after-hours 16:00-20:00 | 5 min |
| Overnight, weekends, NYSE holidays | 30 min |

- **Time zones**: market logic runs on Eastern time. The clock on screen shows
  his local Central time. The server computes both, so the device needs no
  time zone logic.
- **Holidays**: an NYSE holiday and early-close table for 2026-2028 lives in
  the server code.
- **Brightness**: the server sends a brightness value per frame (for example,
  dim from 22:00 to 7:00 Central). The board's light sensor (A5) can scale it
  later.
- **Failures**: the device keeps the last good frame for each screen. If a
  fetch fails it keeps showing that frame and adds a small amber dot in a
  corner. After 30 minutes it shows "OFFLINE since 10:42". It is never blank
  or frozen: the ticker scroll is animated on the device, so it keeps moving
  regardless. A hardware watchdog reboots it if the main loop hangs.

## 8. Security

- Market API keys exist only in Vercel environment variables.
- The device sends a long random token, and the frame and firmware endpoints
  reject requests without it.
- The Google Sheet is edit-shared with you and Dad only. The published CSV
  contains nothing but tickers and messages.
- Firmware updates are checked against a SHA-256 hash and fetched over HTTPS.

## Frame format (for milestone 2)

Raw RGB565, little-endian, with a small header so one response can carry a
static background plus a wide strip that the device scrolls itself:

```
"TKR1"            4 bytes  magic
poll_seconds      u16      when to fetch next
brightness        u8       0-255
flags             u8       bit0 = market open, bit1 = data stale
bg                8192 B   static 64x32 layer
strip_y, strip_h  u8, u8   scrolling region (h = 0 means no strip)
strip_w           u16      width of the wide strip in px
strip             strip_w*strip_h*2
```

A 600 x 18 px ticker strip is about 21 KB, an easy fetch every minute.
