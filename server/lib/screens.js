// The screens. Each returns a layer description the bundle encoder understands:
//   { id, bg: Canvas(64x32), strip?: Canvas, stripY, scrollSpeed, clock?: {x, y, color} }
// The device draws the clock itself (so it keeps ticking offline); the server
// only says where. See docs/protocol.md.
import { Canvas, C, rgb, hexToRgb565, textWidth, W, H } from "./canvas.js";
import { INDEX_ETFS } from "./market.js";

// ---------------------------------------------------------------- formatting

export function fmtPrice(p) {
  if (p >= 10000) return Math.round(p).toLocaleString("en-US");
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(p) {
  const sign = p >= 0 ? "+" : "-";
  const a = Math.abs(p);
  return `${sign}${a >= 10 ? a.toFixed(1) : a.toFixed(2)}%`;
}

export function fmtMultiple(x) {
  return x >= 100 ? `${Math.round(x)}x` : `${x.toFixed(1)}x`;
}

const changeColor = (pct) => (pct > 0.005 ? C.green : pct < -0.005 ? C.red : C.grey);

const STATUS_LABEL = {
  open: ["OPEN", C.green],
  pre: ["PRE-MKT", C.amber],
  after: ["AFTER HRS", C.amber],
  closed: ["CLOSED", C.grey],
  weekend: ["CLOSED", C.grey],
  holiday: ["HOLIDAY", C.grey],
};

// Top bar shared by the ticker and index screens: status left, clock right.
function header(bg, ctx) {
  const [label, color] = ctx.demo ? ["DEMO DATA", C.red] : STATUS_LABEL[ctx.status];
  bg.text(1, 1, label, color, "small");
  bg.hline(0, 7, W, rgb(40, 40, 40));
}

const CLOCK = { x: 63, y: 1, color: C.grey };

// ---------------------------------------------------------------- ticker

export function tickerScreen(ctx) {
  const bg = new Canvas();
  header(bg, ctx);

  const items = ctx.config.symbols
    .map((s) => ({ ...s, q: ctx.quotes[s.symbol] }))
    .filter((s) => s.q);

  const stripY = 9;
  const stripH = H - stripY;
  if (!items.length) {
    bg.text(2, 16, "NO SYMBOLS", C.grey);
    return { id: "ticker", bg, clock: CLOCK };
  }

  const gap = 14;
  const blocks = items.map(({ symbol, label, q }) => {
    const name = label || symbol;
    const pct = fmtPct(q.pct);
    const line1 = textWidth(name) + 4 + 6 + textWidth(pct); // name, arrow, pct
    const line2 = textWidth(fmtPrice(q.price));
    return { name, pct, price: fmtPrice(q.price), q, width: Math.max(line1, line2) };
  });
  const total = blocks.reduce((w, b) => w + b.width + gap, 0);
  const strip = new Canvas(Math.max(total, W), stripH);

  let x = 0;
  for (const b of blocks) {
    const color = changeColor(b.q.pct);
    const cx = x + strip.text(x, 1, b.name, C.white) + 4;
    if (Math.abs(b.q.pct) > 0.005) strip.arrow(cx, 3, b.q.pct > 0, color);
    strip.text(cx + 6, 1, b.pct, color);
    strip.text(x, 12, b.price, rgb(200, 200, 200));
    // small dot separator in the gap
    strip.set(x + b.width + gap / 2, 8, C.dim);
    x += b.width + gap;
  }

  return {
    id: "ticker",
    bg,
    strip,
    stripY,
    scrollSpeed: ctx.config.display.scrollSpeed,
    clock: CLOCK,
  };
}

// ---------------------------------------------------------------- indices

export function indicesScreen(ctx) {
  const bg = new Canvas();
  header(bg, ctx);
  const rows = [9, 17, 25];
  Object.entries(INDEX_ETFS).forEach(([etf, name], i) => {
    const y = rows[i];
    bg.text(1, y + 1, name, rgb(170, 170, 170), "small");
    const q = ctx.quotes[etf];
    if (!q) {
      bg.text(W - textWidth("--"), y, "--", C.grey);
      return;
    }
    const pct = fmtPct(q.pct);
    bg.text(W - textWidth(pct), y, pct, changeColor(q.pct));
  });
  return { id: "indices", bg, clock: CLOCK };
}

// ---------------------------------------------------------------- since 1968

export function since1968Screen(ctx) {
  const { baseDate, baseValue, scale, showDividends } = ctx.config.since1968;
  const { months, latest } = ctx.sp500;
  const bg = new Canvas();

  // Chart: monthly levels from the base month onward, full width, rows 19-31.
  const startYm = baseDate.slice(0, 7);
  const series = months.filter((m) => m[0] >= startYm).map((m) => m[1]);
  series.push(latest.value);
  const top = 19;
  const height = H - top;
  const f = scale === "log" ? Math.log : (v) => v;
  const lo = f(Math.min(...series));
  const hi = f(Math.max(...series));
  const colTop = [];
  for (let x = 0; x < W; x++) {
    // average the months that fall in this column
    const a = Math.floor((x * series.length) / W);
    const b = Math.max(a + 1, Math.floor(((x + 1) * series.length) / W));
    const slice = series.slice(a, b);
    const v = f(slice.reduce((s, n) => s + n, 0) / slice.length);
    const hPx = Math.max(1, Math.round(((v - lo) / (hi - lo || 1)) * (height - 1)) + 1);
    colTop.push(H - hPx);
  }
  colTop.forEach((yTop, x) => {
    for (let y = yTop; y < H; y++) {
      // gradient fill: brighter near the line
      const t = Math.max(0, 1 - (y - yTop) / 8);
      bg.set(x, y, rgb(0, Math.round(40 + 60 * t), Math.round(15 + 20 * t)));
    }
    bg.set(x, yTop, C.green);
  });

  // Headline numbers
  const multiple = latest.value / baseValue;
  bg.text(1, 0, "S&P SINCE '68", C.amber, "small");
  // Big multiple, e.g. "71.2" in the 5x7 font followed by a small "x".
  const w = bg.text(1, 7, fmtMultiple(multiple).slice(0, -1), C.white);
  bg.text(1 + w + 2, 9, "x", C.white, "small");

  if (showDividends) {
    const trMultiple = multiple * dividendFactor(months, startYm);
    if (trMultiple) {
      const tr = fmtMultiple(trMultiple);
      bg.text(W - textWidth(tr, "small"), 7, tr, C.gold, "small");
      bg.text(W - textWidth("W/DIV", "small"), 13, "W/DIV", rgb(150, 110, 30), "small");
    }
  }
  return { id: "since1968", bg };
}

// How much reinvested dividends multiply the price-only gain, from the
// history's total-return index (months after it are treated as price-only).
export function dividendFactor(months, startYm) {
  const withTr = months.filter((m) => m.length > 2);
  const start = withTr.find((m) => m[0] >= startYm);
  const end = withTr[withTr.length - 1];
  if (!start || !end) return null;
  return end[2] / start[2] / (end[1] / start[1]);
}

// ---------------------------------------------------------------- messages

export function messageScreens(ctx) {
  return ctx.config.messages.map((m, i) => messageScreen(m, `message${i ? i + 1 : ""}`, ctx));
}

function messageScreen({ text, color }, id, ctx) {
  const c = hexToRgb565(color);
  const bg = new Canvas();
  const lines = text.toUpperCase().split("\n").map((l) => l.trim()).filter(Boolean);

  const fits = (font, maxLines, lineH) =>
    lines.length <= maxLines && lines.every((l) => textWidth(l, font) <= W);
  const drawCentered = (font, lineH) => {
    const glyphH = font === "big" ? 7 : 5;
    const blockH = lines.length * lineH - (lineH - glyphH);
    let y = Math.floor((H - blockH) / 2);
    for (const l of lines) {
      bg.text(Math.floor((W - textWidth(l, font)) / 2), y, l, c, font);
      y += lineH;
    }
  };

  if (fits("big", 3, 10)) {
    drawCentered("big", 10);
    return { id, bg };
  }
  if (fits("small", 5, 6)) {
    drawCentered("small", 6);
    return { id, bg };
  }
  // Too long: one scrolling line in the middle.
  const line = lines.join("   ");
  const strip = new Canvas(textWidth(line) + 32, 9);
  strip.text(0, 1, line, c);
  return { id, bg, strip, stripY: 12, scrollSpeed: ctx.config.display.scrollSpeed };
}

// ---------------------------------------------------------------- firm progress

export function firmScreen(ctx) {
  const { title, value, goal, percent, color } = ctx.config.firm;
  const c = hexToRgb565(color);
  const bg = new Canvas();
  bg.text(1, 1, title.toUpperCase(), C.amber, "small");
  bg.text(1, 9, value, C.white);
  const pctText = `${Math.round(percent)}%`;
  bg.text(W - textWidth(pctText), 9, pctText, c);
  const goalText = `GOAL ${goal}`.toUpperCase();
  bg.text(1, 19, goalText, C.grey, "small");
  // progress bar
  bg.fillRect(1, 26, 62, 5, rgb(30, 30, 30));
  bg.fillRect(1, 26, Math.round((62 * Math.min(100, percent)) / 100), 5, c);
  return { id: "firm", bg };
}

// ---------------------------------------------------------------- all

export function renderScreens(ctx) {
  const out = [];
  for (const s of ctx.config.screens) {
    if (!s.enabled) continue;
    try {
      if (s.id === "ticker") out.push(tickerScreen(ctx));
      if (s.id === "indices") out.push(indicesScreen(ctx));
      if (s.id === "since1968") out.push(since1968Screen(ctx));
      if (s.id === "message") out.push(...messageScreens(ctx));
      if (s.id === "firm") out.push(firmScreen(ctx));
    } catch (e) {
      console.error("screen failed", s.id, e);
    }
  }
  if (!out.length) {
    const bg = new Canvas();
    bg.text(2, 12, "NO SCREENS", C.grey);
    out.push({ id: "empty", bg, clock: { x: 63, y: 1, color: C.grey } });
  }
  return out;
}
