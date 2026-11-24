// Opening/closing bell animations, generated on the fly as TKA1 (see
// docs/protocol.md). The asset id carries everything needed to draw it:
//   "bell-o"          opening bell
//   "bell-c"          closing bell, no recap
//   "bell-c+0.84"     closing bell with the S&P's move for the day
import { Canvas, C, rgb, textWidth } from "./canvas.js";

const AMBER = rgb(255, 176, 0);
const FRAME_MS = 50;
const FRAMES = 90;       // 4.5 s of motion
const HOLD_MS = 1500;    // then the settled bell stays up a moment

// Bell pixel art, 11 x 11. B body, H highlight, D shade, K clapper.
const BELL = [
  "....DDD....",
  "...HBBBD...",
  "..HBBBBBD..",
  "..HBBBBBD..",
  "..HBBBBBD..",
  ".HBBBBBBBD.",
  ".HBBBBBBBD.",
  "HBBBBBBBBBD",
  "DDDDDDDDDDD",
  "....KKK....",
  ".....K.....",
];
const COL = { B: rgb(255, 190, 0), H: rgb(255, 235, 140), D: rgb(190, 120, 0), K: rgb(150, 100, 20) };

function drawBell(c, x0, y0, swing) {
  // Shear rows by their distance from the pivot for a pixel-clean swing;
  // the clapper lags behind the body.
  BELL.forEach((row, y) => {
    const dx = Math.round(swing * (y >= 9 ? -0.6 : 1) * y * 0.22);
    for (let x = 0; x < row.length; x++) if (row[x] !== ".") c.set(x0 + x + dx, y0 + y, COL[row[x]]);
  });
}

function drawWaves(c, x, y, side, fade) {
  const k = 1 - fade;
  const col = rgb(Math.round(255 * k), Math.round(230 * k), Math.round(140 * k));
  for (let i = 0; i < 2; i++) {
    const ax = x + side * (3 + i * 3);
    for (let dy = -2 - i; dy <= 2 + i; dy++) c.set(ax + side * (Math.abs(dy) > 1 + i ? -1 : 0), y + dy, col);
  }
}

// Parses an asset id; returns null if it isn't a bell.
export function parseBellId(id) {
  const m = /^bell-(o|c)([+-]\d{1,2}\.\d{2})?$/.exec(id || "");
  if (!m) return null;
  return { kind: m[1] === "o" ? "open" : "close", recapPct: m[2] === undefined ? null : Number(m[2]) };
}

export function bellId(kind, recapPct = null) {
  if (kind === "open") return "bell-o";
  if (recapPct === null || !Number.isFinite(recapPct) || Math.abs(recapPct) >= 100) return "bell-c";
  return `bell-c${recapPct >= 0 ? "+" : "-"}${Math.abs(recapPct).toFixed(2)}`;
}

// Draws frame f (0..FRAMES-1) of a bell.
function bellFrame({ kind, recapPct }, f, closeLabel) {
  const c = new Canvas();
  const t = f / (1000 / FRAME_MS);
  const amp = t < 2.4 ? 1 : Math.max(0, 1 - (t - 2.4) / 0.8); // three rings, then settle
  const swing = Math.sin(t * Math.PI * 2.5) * amp;
  drawBell(c, 3, 6, swing);
  if (amp > 0.3 && Math.abs(swing) > 0.5) {
    drawWaves(c, 8 + Math.round(swing * 3), 11, Math.sign(swing), Math.abs(swing) > 0.85 ? 0 : 0.5);
  }
  c.text(22, 3, kind === "open" ? "OPENING" : "CLOSING", AMBER);
  c.text(22, 12, "BELL", AMBER);
  if (kind === "open") {
    c.text(22, 23, "9:30 ET", C.grey, "small");
  } else if (recapPct !== null) {
    const pct = `${recapPct >= 0 ? "+" : "-"}${Math.abs(recapPct).toFixed(2)}%`;
    c.text(22, 23, "S&P", AMBER, "small");
    c.text(22 + textWidth("S&P ", "small"), 23, pct, recapPct > 0.005 ? C.green : recapPct < -0.005 ? C.red : C.grey, "small");
  } else {
    c.text(22, 23, closeLabel, C.grey, "small");
  }
  return c.px;
}

// Builds the TKA1 file for a bell id. Identical consecutive frames are merged.
export function renderBell(id, { closeLabel = "4:00 ET" } = {}) {
  const spec = parseBellId(id);
  if (!spec) return null;
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const px = bellFrame(spec, f, closeLabel);
    const last = frames[frames.length - 1];
    if (last && last.px.every((v, i) => v === px[i])) last.ms += FRAME_MS;
    else frames.push({ px: Uint16Array.from(px), ms: FRAME_MS });
  }
  frames[frames.length - 1].ms += HOLD_MS;
  return encodeTka(frames);
}

// frames: [{ px: Uint16Array(2048), ms }]
export function encodeTka(frames) {
  const parts = [];
  let total = 0;
  for (const { px, ms } of frames) {
    const runs = [];
    for (let i = 0; i < px.length; ) {
      let j = i;
      while (j < px.length && px[j] === px[i] && j - i < 255) j++;
      runs.push([j - i, px[i]]);
      i = j;
    }
    const raw = runs.length * 3 >= 4096; // RLE only when it's smaller
    let data;
    if (!raw) {
      data = Buffer.alloc(runs.length * 3);
      runs.forEach(([n, c], k) => { data.writeUInt8(n, k * 3); data.writeUInt16LE(c, k * 3 + 1); });
    } else {
      data = Buffer.alloc(4096);
      px.forEach((c, k) => data.writeUInt16LE(c, k * 2));
    }
    const h = Buffer.alloc(5);
    h.writeUInt16LE(Math.min(65535, ms), 0);
    h.writeUInt8(raw ? 0 : 1, 2);
    h.writeUInt16LE(data.length, 3);
    parts.push(h, data);
    total += ms;
  }
  const head = Buffer.alloc(14);
  head.write("TKA1", 0, "ascii");
  head.writeUInt16LE(64, 4);
  head.writeUInt16LE(32, 6);
  head.writeUInt16LE(frames.length, 8);
  head.writeUInt32LE(total, 10);
  return Buffer.concat([head, ...parts]);
}
