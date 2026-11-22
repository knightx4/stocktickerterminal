# Stock ticker terminal

A 64x32 LED desk display that shows live market data. It runs on an Adafruit
Matrix Portal S3. A small server on Vercel renders the screens, and the device
fetches and draws them. Design choices are in [docs/decisions.md](docs/decisions.md).

```
firmware/   Arduino (PlatformIO) code for the Matrix Portal S3
docs/       decisions and notes
server/     (milestone 3) Vercel functions that render frames
```

## Ticker firmware

1. Set `SERVER_URL` and `DEVICE_TOKEN` in `firmware/src/config.h`.
2. Flash it: `cd firmware`, then `pio run -e ticker -t upload`. `ticker` is the
   default env, so a plain `pio run -t upload` also works.
3. On first boot, join the `Ticker-Setup` Wi-Fi network from a phone and pick
   the home network.

Hold a button while pressing **Reset**:
- **UP** opens Wi-Fi setup again.
- **DOWN** toggles the FM6126A panel init.

The bundle parser has a desktop test: `firmware/tools/run_host_test.sh`.

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
