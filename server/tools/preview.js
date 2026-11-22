// Renders every screen to an LED-style PNG for checking layouts locally.
//   node tools/preview.js [outDir]
// Uses demo data unless FINNHUB_KEY / FRED_KEY are set. No database needed.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { buildScreens, encodeBundle } from "../lib/bundle.js";
import { DEFAULT_CONFIG, sanitizeConfig } from "../lib/config.js";
import { decodeBundle, composite, rgb565to888 } from "../public/decode.js";

const outDir = process.argv[2] || "preview";
mkdirSync(outDir, { recursive: true });

const config = sanitizeConfig({
  ...DEFAULT_CONFIG,
  screens: DEFAULT_CONFIG.screens.map((s) => ({ ...s, enabled: true })),
  firm: { title: "Firm AUM", value: "$412M", goal: "$500M", percent: 82, color: "#3c8cff" },
});
const now = new Date(process.env.PREVIEW_TIME || Date.now());
const built = await buildScreens({ now, config });
const bundle = encodeBundle(built, now);
const { header, screens } = decodeBundle(bundle);
console.log(`bundle ${bundle.length} bytes, ${screens.length} screens, poll ${header.poll}s, flags ${header.flags}`);

const SCALE = 8;
for (const s of screens) {
  const px = composite(s, header, Number(process.env.PREVIEW_OFFSET || 0));
  writeFileSync(`${outDir}/${s.id}.png`, png(px, SCALE));
  console.log(`  ${s.id}: strip ${s.stripW}x${s.stripH}`);
}

function png(px, scale) {
  const w = 64 * scale, h = 32 * scale;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb565to888(px[Math.floor(y / scale) * 64 + Math.floor(x / scale)]);
      // round LED dots with a dark gap
      const dx = (x % scale) - scale / 2 + 0.5, dy = (y % scale) - scale / 2 + 0.5;
      const on = dx * dx + dy * dy < (scale * 0.42) ** 2;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = on ? Math.max(r, 18) : 8;
      raw[o + 1] = on ? Math.max(g, 18) : 8;
      raw[o + 2] = on ? Math.max(b, 18) : 8;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
