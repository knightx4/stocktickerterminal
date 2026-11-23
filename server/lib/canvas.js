// A tiny pixel canvas that stores RGB565 values, plus text drawing in two
// pixel fonts: "big" (5x7, 6 px per char) and "small" (3x5, 4 px per char).
import { FONT5X7 } from "./font5x7.js";
import { glyph3x5 } from "./font3x5.js";

export const W = 64;
export const H = 32;

export function rgb(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export const C = {
  black: 0,
  white: rgb(255, 255, 255),
  grey: rgb(150, 150, 150),
  dim: rgb(60, 60, 60),
  green: rgb(0, 255, 0),  // pure colors stay true when the device dims them at night
  red: rgb(255, 0, 0),
  amber: rgb(255, 170, 0),
  blue: rgb(40, 140, 255),
  cyan: rgb(0, 200, 220),
  gold: rgb(255, 200, 60),
};

export function hexToRgb565(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return C.white;
  const n = parseInt(m[1], 16);
  return rgb(n >> 16, (n >> 8) & 255, n & 255);
}

export class Canvas {
  constructor(width = W, height = H) {
    this.width = width;
    this.height = height;
    this.px = new Uint16Array(width * height);
  }

  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = c;
  }

  get(x, y) {
    return this.px[y * this.width + x];
  }

  fillRect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  hline(x, y, w, c) {
    this.fillRect(x, y, w, 1, c);
  }

  // Triangle arrow, 5 wide x 4 tall (big font) or 3x2 (small).
  arrow(x, y, up, c, small = false) {
    const rows = small ? [[1, 1], [0, 3]] : [[2, 1], [1, 3], [0, 5]];
    rows.forEach(([off, len], i) => {
      const row = up ? i : rows.length - 1 - i;
      this.hline(x + off, y + row, len, c);
    });
  }

  // Draws text; returns its width in px. font: "big" | "small".
  text(x, y, str, c, font = "big") {
    let cx = x;
    for (const ch of String(str)) {
      if (font === "big") {
        const cols = FONT5X7[ch] ?? FONT5X7["?"];
        cols.forEach((bits, i) => {
          for (let r = 0; r < 7; r++) if (bits & (1 << r)) this.set(cx + i, y + r, c);
        });
        cx += 6;
      } else {
        const g = glyph3x5(ch);
        g.forEach((row, r) => {
          for (let i = 0; i < row.length; i++) if (row[i] === "#") this.set(cx + i, y + r, c);
        });
        cx += g[0].length + 1;
      }
    }
    return Math.max(0, cx - x - 1);
  }

  // Copy another canvas onto this one at (dx, dy).
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) this.set(dx + x, dy + y, src.get(x, y));
  }
}

export function textWidth(str, font = "big") {
  if (font === "big") return Math.max(0, String(str).length * 6 - 1);
  let w = 0;
  for (const ch of String(str)) w += glyph3x5(ch)[0].length + 1;
  return Math.max(0, w - 1);
}
