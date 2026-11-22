// Decodes a TKB1 bundle and composites a screen exactly as the device would
// (bg, strip at an offset, clock). Used by tests and the preview tool; the
// admin page has a browser copy of the same logic.

export function decodeBundle(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(...buf.subarray(0, 4));
  if (magic !== "TKB1") throw new Error("bad magic");
  const h = {
    version: dv.getUint8(4),
    count: dv.getUint8(5),
    poll: dv.getUint16(6, true),
    brightness: dv.getUint8(8),
    flags: dv.getUint8(9),
    dwell: dv.getUint16(10, true),
    time: dv.getUint32(12, true),
    utcOffset: dv.getInt16(16, true),
  };
  let o = 24;
  const screens = [];
  for (let i = 0; i < h.count; i++) {
    const idLen = dv.getUint8(o++);
    const id = String.fromCharCode(...buf.subarray(o, o + idLen));
    o += idLen;
    const s = { id };
    s.clockX = dv.getUint8(o++);
    s.clockY = dv.getUint8(o++);
    s.clockColor = dv.getUint16(o, true); o += 2;
    s.stripY = dv.getUint8(o++);
    s.stripH = dv.getUint8(o++);
    s.stripW = dv.getUint16(o, true); o += 2;
    s.speed = dv.getUint8(o++);
    o++;
    s.bg = new Uint16Array(64 * 32);
    for (let p = 0; p < 2048; p++, o += 2) s.bg[p] = dv.getUint16(o, true);
    s.strip = new Uint16Array(s.stripW * s.stripH);
    for (let p = 0; p < s.strip.length; p++, o += 2) s.strip[p] = dv.getUint16(o, true);
    screens.push(s);
  }
  if (o !== buf.byteLength) throw new Error(`length mismatch: parsed ${o}, got ${buf.byteLength}`);
  return { header: h, screens };
}

export const CLOCK_DIGITS = {
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["###", "..#", "###", "#..", "###"], 3: ["###", "..#", "###", "..#", "###"],
  4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "###", "..#", "###"],
  6: ["###", "#..", "###", "#.#", "###"], 7: ["###", "..#", "..#", "..#", "..#"],
  8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "###"],
  ":": [".", "#", ".", "#", "."],
};

export function clockText(unixSeconds, utcOffsetMin, h24) {
  const d = new Date((unixSeconds + utcOffsetMin * 60) * 1000);
  let hh = d.getUTCHours();
  if (!h24) hh = hh % 12 || 12;
  return `${h24 ? String(hh).padStart(2, "0") : hh}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// Returns a 64x32 Uint16Array of the composited screen.
export function composite(screen, header, offset = 0) {
  const out = Uint16Array.from(screen.bg);
  if (screen.stripH) {
    for (let y = 0; y < screen.stripH; y++)
      for (let x = 0; x < 64; x++)
        out[(screen.stripY + y) * 64 + x] = screen.strip[y * screen.stripW + ((offset + x) % screen.stripW)];
  }
  if (screen.clockX !== 255) {
    const t = clockText(header.time, header.utcOffset, header.flags & 8);
    const glyphs = [...t].map((c) => CLOCK_DIGITS[c]);
    const width = glyphs.reduce((w, g) => w + g[0].length + 1, -1);
    let x = screen.clockX - width + 1;
    for (const g of glyphs) {
      g.forEach((row, r) => {
        for (let i = 0; i < row.length; i++)
          if (row[i] === "#") out[(screen.clockY + r) * 64 + x + i] = screen.clockColor;
      });
      x += g[0].length + 1;
    }
  }
  return out;
}

export function rgb565to888(v) {
  const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
