// Animations (TKA1 files, see docs/protocol.md), e.g. the birthday sequence.
// They contain private photos, so they live in Supabase (ticker.asset), not in
// git. The device downloads one once via /api/asset and plays it itself.
import { crc32 } from "node:zlib";
import { dbGetAsset } from "./db.js";
import { parseBellId, renderBell } from "./bell.js";

// Parses a TKA1 buffer into a frame index. Throws on malformed data.
export function parseAnimation(buf) {
  if (buf.length < 14 || buf.toString("ascii", 0, 4) !== "TKA1") throw new Error("not a TKA1 animation");
  const w = buf.readUInt16LE(4), h = buf.readUInt16LE(6), count = buf.readUInt16LE(8);
  if (w !== 64 || h !== 32) throw new Error(`unsupported size ${w}x${h}`);
  const frames = [];
  let o = 14, total = 0;
  for (let i = 0; i < count; i++) {
    if (o + 5 > buf.length) throw new Error("truncated frame header");
    const ms = buf.readUInt16LE(o), enc = buf.readUInt8(o + 2), len = buf.readUInt16LE(o + 3);
    o += 5;
    if (o + len > buf.length || enc > 1 || (enc === 0 && len !== 4096) || (enc === 1 && len % 3)) {
      throw new Error(`bad frame ${i}`);
    }
    frames.push({ ms, enc, offset: o, len });
    total += ms;
    o += len;
  }
  if (o !== buf.length) throw new Error("trailing bytes");
  return { frames, totalMs: total };
}

// Decodes one frame into 2048 RGB565 values.
export function decodeFrame(buf, f) {
  const px = new Uint16Array(2048);
  if (f.enc === 0) {
    for (let i = 0; i < 2048; i++) px[i] = buf.readUInt16LE(f.offset + i * 2);
    return px;
  }
  let p = 0;
  for (let o = f.offset; o < f.offset + f.len && p < 2048; o += 3) {
    const run = buf.readUInt8(o), c = buf.readUInt16LE(o + 1);
    for (let k = 0; k < run && p < 2048; k++) px[p++] = c;
  }
  return px;
}

// In-memory cache per server instance; the asset rarely changes.
const cache = new Map(); // id -> { at, value }
const TTL_MS = 10 * 60 * 1000;

// Returns { id, buf, crc, size, index } or null if the asset doesn't exist.
export async function loadAnimation(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    // Bells are generated from their id; everything else comes from the database.
    const buf = parseBellId(id) ? renderBell(id) : await dbGetAsset(id);
    const value = buf ? { id, buf, crc: crc32(buf) >>> 0, size: buf.length, index: parseAnimation(buf) } : null;
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.error("loadAnimation", id, e.message);
    return hit?.value ?? null; // keep serving the last good copy
  }
}
