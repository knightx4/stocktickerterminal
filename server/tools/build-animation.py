"""Pack an animation (frames + timeline.json) into a TKA1 file for the device.

Usage: python3 tools/build-animation.py <dir with timeline.json and frames/> <out.tka>

The output contains the frames themselves, so keep it OUT of git if they're
private (e.g. family photos). Upload it to Supabase instead (see README).

Format (little-endian), see docs/protocol.md:
  "TKA1", u16 width=64, u16 height=32, u16 frame_count, u32 total_ms
  per frame: u16 ms, u8 encoding (0 raw, 1 RLE), u16 byte_length, data
    raw: 2048 x u16 RGB565
    RLE: repeated (u8 run 1..255, u16 RGB565) covering 2048 pixels
"""
import json, struct, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
t = json.load(open(f"{src}/timeline.json"))
assert t["width"] == 64 and t["height"] == 32

def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

body = bytearray()
raw_total = 0
for f in t["frames"]:
    im = Image.open(f"{src}/frames/{f['file']}").convert("RGB")
    assert im.size == (64, 32), f["file"]
    b = im.tobytes()
    px = [rgb565(b[k], b[k + 1], b[k + 2]) for k in range(0, len(b), 3)]
    raw = struct.pack("<2048H", *px)
    rle = bytearray()
    i = 0
    while i < len(px):
        j = i
        while j < len(px) and px[j] == px[i] and j - i < 255:
            j += 1
        rle += struct.pack("<BH", j - i, px[i])
        i = j
    enc, data = (1, rle) if len(rle) < len(raw) else (0, raw)
    body += struct.pack("<HBH", min(65535, int(f["ms"])), enc, len(data)) + data
    raw_total += len(raw)

total_ms = sum(int(f["ms"]) for f in t["frames"])
blob = b"TKA1" + struct.pack("<HHHI", 64, 32, len(t["frames"]), total_ms) + bytes(body)
open(out, "wb").write(blob)
print(f"{len(t['frames'])} frames, {total_ms} ms, {len(blob)} bytes (raw would be {raw_total})")
