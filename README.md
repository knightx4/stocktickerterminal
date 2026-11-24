# Stock ticker terminal

A 64x32 LED desk display that shows live market data. It runs on an Adafruit
Matrix Portal S3. A small server on Vercel renders the screens, and the device
fetches and draws them. Design choices are in [docs/decisions.md](docs/decisions.md).

- **Settings page:** https://dad-ticker-blush.vercel.app (password protected)
- **Vercel project:** `dad-ticker`, which deploys automatically on every push to
  this branch
- **Database:** the `ticker` schema in the `personal-dashboard` Supabase project

```
firmware/   Arduino (PlatformIO) code for the Matrix Portal S3
server/     Vercel functions, the settings page, and screen rendering
docs/       decisions.md (why) and protocol.md (device/server format)
```

## Server setup

Set these environment variables in the Vercel project (Settings, then
Environment Variables), then redeploy:

| Variable | What it is | Status |
|---|---|---|
| `DEVICE_TOKEN` | Shared secret the device sends | set |
| `ADMIN_PASSWORD` | Settings page password | set |
| `SUPABASE_URL` | `https://asjztutnqxbecruvyrbj.supabase.co` | set |
| `SUPABASE_KEY` | The project's publishable key | set |
| `TICKER_DB_SECRET` | Unlocks the `ticker.get_row` / `put_row` database functions; only its SHA-256 is stored in `ticker.secret` | set |
| `FINNHUB_KEY` | Free key from finnhub.io | set |
| `FRED_KEY` | Free key from fred.stlouisfed.org (My Account, then API Keys) | set |
| `TWELVEDATA_KEY` | Optional fallback, free key from twelvedata.com | optional |

Without the keys, everything still works on demo data: the screens show
"DEMO DATA", and settings can't be saved until the database is configured.

To rotate `TICKER_DB_SECRET`, run this in the Supabase SQL editor, then update
the Vercel variable to match and redeploy:

```sql
update ticker.secret set sha256 = encode(extensions.digest('NEW-SECRET', 'sha256'), 'hex');
```

Run it locally:

```bash
cd server && npm test
```

```bash
cd server && ADMIN_PASSWORD=test DEVICE_TOKEN=dev LOCAL_DB=./local-db.json node tools/dev.js
```

`node tools/preview.js` writes PNG previews of every screen.

## Ticker firmware

1. Copy `firmware/src/secrets.example.h` to `firmware/src/secrets.h` and paste
   in the device token. `secrets.h` is gitignored because this repo is public.
   `SERVER_URL` is already set in `firmware/src/config.h`.
2. Flash it:

   ```bash
   cd firmware && pio run -e ticker -t upload
   ```

3. On first boot, join the `Ticker-Setup` Wi-Fi network from a phone and pick
   the home network.

Hold a button while pressing **Reset**:
- **UP** opens Wi-Fi setup again.
- **DOWN** toggles the FM6126A panel init.

The bundle parser has a desktop test: `firmware/tools/run_host_test.sh`.

### Firmware updates over the air

1. Raise `FW_VERSION` in `config.h` and build with `pio run -e ticker`.
2. Upload `firmware/.pio/build/ticker/firmware.bin` somewhere with an HTTPS
   link, for example a GitHub Release asset.
3. On the settings page, open Device, then Firmware update. Enter the version,
   the URL, and the MD5 (`md5sum firmware.bin`), then save.
4. Within 5 minutes the device installs it. If the new version can't fetch
   screens, it rolls back to the old one after a reset.

## Birthday animation

The birthday sequence contains family photos, and this repo is public, so the
frames are kept out of git. They live in Supabase (`ticker.asset`, id
`birthday`), and the server serves them only to the device and the settings
page. To rebuild it from the handoff folder (`timeline.json` plus `frames/`):

```bash
cd server && python3 tools/build-animation.py <handoff-dir> birthday.tka --photo-gamma 1.8 --photo-scale 0.8 --photo-gamma-mode luma --photo-black 16 --photo-dark-desat 56
```

These are the current settings (2026-11-24). They darken the photo montage
for the LEDs: brightness-only gamma, so colours don't get exaggerated, plus
80% brightness so faces don't wash out. Upload the result with the
`ticker.put_asset(TICKER_DB_SECRET, 'birthday', <base64>)` database function.
The server picks it up within 10 minutes and the device within 2 more.

These settings assume firmware 4 or later. Firmware 3 lights near-black
pixels as stray red/green specks, so it needs a deeper cut:
`--photo-black 24 --photo-dark-desat 72`.

## Milestone 1: panel test

### Flash it

1. Install [PlatformIO](https://platformio.org/install/cli). The easiest way is
   the VS Code extension; with Python you can run `pip install platformio`.
2. Plug the Matrix Portal S3 into the panel's HUB75 input. Connect the panel
   power cable to the board's power terminals, then connect USB-C.
3. Build and upload:

   ```bash
   cd firmware
   ```

   ```bash
   pio run -e paneltest -t upload
   ```

   If upload can't find the board, put it in bootloader mode: hold **Boot**,
   tap **Reset**, release **Boot**, then upload again. After a bootloader-mode
   upload, press **Reset** once to start the new firmware.
4. Watch the logs:

   ```bash
   pio device monitor
   ```

### What you should see

Pages change every 4 seconds. Press UP or DOWN to step through them by hand.

| Page | Check |
|---|---|
| 0 Info | Corner squares: **red top-left, green top-right, blue bottom-left, white bottom-right**. "ACCEL OK" in green. |
| 1-4 Red / Green / Blue / White | Each fill matches its label. White is dimmed on purpose, to stay within USB power. |
| 5 Gradients | Smooth red, green, blue and grey ramps from left to right |
| 6 Grid | Even lines every 8 px, with no doubled or missing rows |
| 7 Wi-Fi scan | Finds your networks **while the panel stays steady**. This is the key test: Wi-Fi and the display must coexist. |
| 8 Ticker preview | Smooth scrolling quotes, no flicker |

The status LED on the board shows blue while booting, green while running, and
red if the display failed to start.

### Troubleshooting

- **Panel stays completely dark**: it may have an FM6126A driver chip. Hold
  **DOWN** and tap **Reset**. The setting toggles and is remembered (the info
  page shows `DRV FM6126A`). Do the same again to switch it back.
- **Colors swapped** (for example, the red page shows blue): note which pages
  show which colors and change the order of `rgbPins` in `firmware/src/board.h`.
- **Image upside down**: the panel is mounted rotated. This gets fixed in
  software later; just note it.
- **Rows doubled, or the image split into bands**: report what the grid page
  looks like. It points to the panel's scan or address type.
- **ACCEL --**: the LIS3DH didn't answer at 0x19. This doesn't matter for
  milestone 1.
