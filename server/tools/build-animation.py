"""Pack an animation (frames + timeline.json) into a TKA1 file for the device.

Usage: python3 tools/build-animation.py <dir with timeline.json and frames/> <out.tka>
           [--photo-gamma 2.2] [--photo-scale 1.0]

LED panels light up linearly, so photos look washed out unless their
mid-tones are darkened (gamma). --photo-gamma/--photo-scale apply only to
"photo" frames (many distinct colours); text and pixel-art frames are left
exactly as designed.

The output contains the frames themselves, so keep it OUT of git if they're
private (e.g. family photos). Upload it to Supabase instead (see README).

Format (little-endian), see docs/protocol.md:
  "TKA1", u16 width=64, u16 height=32, u16 frame_count, u32 total_ms
  per frame: u16 ms, u8 encoding (0 raw, 1 RLE), u16 byte_length, data
    raw: 2048 x u16 RGB565
    RLE: repeated (u8 run 1..255, u16 RGB565) covering 2048 pixels
"""
import argparse, json, struct
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--photo-gamma", type=float, default=1.0)
ap.add_argument("--photo-scale", type=float, default=1.0)
ap.add_argument("--photo-min-colors", type=int, default=48)
args = ap.parse_args()
src, out = args.src, args.out
lut = [min(255, round(255 * ((v / 255) ** args.photo_gamma) * args.photo_scale)) for v in range(256)]
t = json.load(open(f"{src}/timeline.json"))
assert t["width"] == 64 and t["height"] == 32

def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

def colours(im):
    return len(set(im.tobytes()[k:k + 3] for k in range(0, 64 * 32 * 3, 3)))

# Photo montage = first to last frame with many colours, so fades and
# crossfades inside it get the same correction (no brightness jumps).
images = [Image.open(f"{src}/frames/{f['file']}").convert("RGB") for f in t["frames"]]
photo = [i for i, im in enumerate(images) if colours(im) >= args.photo_min_colors]
photo_range = range(photo[0], photo[-1] + 1) if photo and args.photo_gamma * args.photo_scale != 1 else range(0)

body = bytearray()
raw_total = 0
photo_frames = 0
for idx, (f, im) in enumerate(zip(t["frames"], images)):
    assert im.size == (64, 32), f["file"]
    if idx in photo_range:
        im = im.point(lut * 3)
        photo_frames += 1
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
print(f"{len(t['frames'])} frames ({photo_frames} adjusted as photos: {photo_range.start}-{photo_range.stop - 1}), {total_ms} ms, "
      f"{len(blob)} bytes (raw would be {raw_total})")
