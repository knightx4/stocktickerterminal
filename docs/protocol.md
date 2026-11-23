# Device ⇄ server protocol

The device is a thin client. It polls one cached endpoint for pre-rendered
screens and reports a heartbeat. All multi-byte numbers are **little-endian**.
Colors are **RGB565**.

## `GET /api/bundle?t=<DEVICE_TOKEN>`

Returns `application/octet-stream`: every enabled screen in one response, so
button presses switch screens instantly and an outage still leaves every screen
with its last data. It is never cached (`no-store`), because the device sets
its clock from `server_time`.

### Header (24 bytes)

| Offset | Type | Field |
|---|---|---|
| 0 | char[4] | magic `"TKB1"` |
| 4 | u8 | version = 1 |
| 5 | u8 | screen_count |
| 6 | u16 | poll_seconds: when to fetch again |
| 8 | u8 | brightness 0-255, applied by the device |
| 9 | u8 | flags (see below) |
| 10 | u16 | dwell_seconds: auto-advance to the next screen after this long, 0 = off |
| 12 | u32 | server_time, Unix seconds (UTC) |
| 16 | i16 | utc_offset_min for the clock (for example, -360 = CST, -300 = CDT) |
| 18 | u8[6] | reserved, 0 |

The flags byte:
- bit0: stale. The server couldn't refresh market data, so this frame shows
  older data.
- bit1: the market is open.
- bit2: double-tap enabled. A double-tap on the case advances to the next
  screen.
- bit3: 24-hour clock. Otherwise the clock uses 12-hour time with no leading
  zero (`9:42`).

### Per screen, repeated `screen_count` times

| Type | Field |
|---|---|
| u8 | id_len |
| char[id_len] | id (ASCII, for example `ticker`) |
| u8 | clock_x: the rightmost pixel column of the clock text; 255 = no clock |
| u8 | clock_y: the top row of the clock text |
| u16 | clock_color, RGB565 |
| u8 | strip_y: the top row of the scrolling strip |
| u8 | strip_h: height in rows; 0 = no strip |
| u16 | strip_w: width in pixels |
| u8 | scroll_speed in pixels per second; 0 = static |
| u8 | reserved, 0 |
| u16[64*32] | bg: the static layer, row-major |
| u16[strip_w*strip_h] | strip, row-major |

### Drawing rules (device)

1. Draw `bg`.
2. If `strip_h > 0`, the strip covers rows `strip_y .. strip_y+strip_h-1`
   completely, black pixels included. Screen column `x` shows strip column
   `(offset + x) mod strip_w`, where `offset` advances `scroll_speed` px/s.
   The server renders the strip so that it loops seamlessly. If
   `scroll_speed == 0`, then `offset = 0`.
3. If `clock_x != 255`, draw the local time using the 3x5 clock font, with the
   rightmost lit column at `clock_x` and the top row at `clock_y`.
   - Glyphs are 3 px wide with 1 px between characters. `:` is 1 px wide
     (lit at rows 1 and 3).
   - `12:45` is 17 px wide.
   - Local time = server_time + seconds since the fetch + utc_offset_min × 60.
   - The server leaves this area blank.
4. The device draws its own status indicators on top, in the bottom-right
   pixel (63,31):
   - Amber when stale: flag bit0 is set, or the last successful fetch is older
     than max(3 × poll_seconds, 300 s).
   - Red when there has been no successful fetch for 30 minutes.
5. Every color is scaled by `brightness/255` before it is shown.

### Clock digit glyphs (3x5, `#` = lit), shared by the device and the server preview

```
0 ###  1 .#.  2 ###  3 ###  4 #.#  5 ###  6 ###  7 ###  8 ###  9 ###
  #.#    ##.    ..#    ..#    #.#    #..    #..    ..#    #.#    #.#
  #.#    .#.    ###    ###    ###    ###    ###    ..#    ###    ###
  #.#    .#.    #..    ..#    ..#    ..#    #.#    ..#    #.#    ..#
  ###    ###    ###    ###    ..#    ###    ###    ..#    ###    ###
```

## `POST /api/ping?t=<DEVICE_TOKEN>`

This is a heartbeat, sent every 5 minutes and at boot. It is never cached.

Request JSON:
`{"fw": 3, "uptime": 12345, "rssi": -61, "heap": 123456, "screen": "ticker", "ip": "192.168.1.20", "reset": "poweron", "err": "last error text or empty"}`

Response JSON:
`{"firmware": {"version": 4, "url": "https://…/firmware.bin", "md5": "hex"} | null}`

If `firmware.version` is greater than the device's own `FW_VERSION`, the device
downloads `url` over HTTPS into the inactive OTA slot, checks the MD5, and
reboots. The new image marks itself valid only after its first successful
bundle fetch. If it never gets that far, the bootloader rolls it back on the
next reset.

## Authentication

`t` must match the server's `DEVICE_TOKEN` env var; otherwise the response is
`401`. The admin page uses the separate `ADMIN_PASSWORD` instead.
