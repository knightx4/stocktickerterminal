#!/usr/bin/env python3
"""Writes a sample TKB1 bundle (docs/protocol.md) for testing the firmware parser.

Usage: python3 make_sample_bundle.py out.bin
Screen 0 "ticker": red bg, clock at right edge 63 / top 1, a 100x9 strip at y=12, 30 px/s.
Screen 1 "since1968": green bg, no clock, no strip.
"""
import struct
import sys


def rgb565(r, g, b):
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def screen(sid, bg_color, clock, strip):
    out = bytes([len(sid)]) + sid.encode()
    cx, cy, ccol = clock if clock else (255, 0, 0)
    sy, sh, sw, speed, scol = strip if strip else (0, 0, 0, 0, 0)
    out += struct.pack("<BBHBBHBB", cx, cy, ccol, sy, sh, sw, speed, 0)
    out += struct.pack("<H", bg_color) * (64 * 32)
    out += struct.pack("<H", scol) * (sw * sh)
    return out


def bundle():
    header = b"TKB1" + struct.pack("<BBHBBHIh", 1, 2, 60, 200, 0b0110, 8, 1795000000, -360) + bytes(6)
    assert len(header) == 24
    body = screen("ticker", rgb565(255, 0, 0), (63, 1, rgb565(200, 200, 200)),
                  (12, 9, 100, 30, rgb565(0, 0, 255)))
    body += screen("since1968", rgb565(0, 255, 0), None, None)
    return header + body


if __name__ == "__main__":
    data = bundle()
    with open(sys.argv[1], "wb") as f:
        f.write(data)
    print(f"wrote {len(data)} bytes")
