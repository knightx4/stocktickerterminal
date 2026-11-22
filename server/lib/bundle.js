// Builds the TKB1 binary bundle described in docs/protocol.md.
import { loadConfig } from "./config.js";
import { getQuotes, getSp500, quoteProvider } from "./market.js";
import { marketStatus, pollSeconds, zonedParts, utcOffsetMinutes, hhmmToMinutes, inWindow } from "./hours.js";
import { renderScreens } from "./screens.js";

const STALE_AFTER_MS = 15 * 60 * 1000;

// Gathers config + data and renders every screen. Used by /api/bundle and tests.
export async function buildScreens({ now = new Date(), config } = {}) {
  config = config ?? (await loadConfig());
  const { status } = marketStatus(now);
  const poll = pollSeconds(status);
  // Quotes don't move while the market is shut, so keep them longer then.
  const quoteTtl = status === "open" ? poll - 5 : status === "pre" || status === "after" ? 240 : 1800;

  const [q, sp500] = await Promise.all([
    getQuotes(config.symbols.map((s) => s.symbol), quoteTtl).catch((e) => {
      console.error("quotes unavailable", e.message);
      return { quotes: {}, updatedAt: 0, ok: false };
    }),
    getSp500(),
  ]);

  const quotesAge = now.getTime() - q.updatedAt;
  const stale = !q.ok && (status === "open" ? quotesAge > STALE_AFTER_MS : quotesAge > 24 * 3600e3);
  const ctx = { config, quotes: q.quotes, sp500, status, now, demo: quoteProvider() === "demo" };
  return { config, status, poll, stale, screens: renderScreens(ctx), quotesUpdatedAt: q.updatedAt };
}

export function brightnessFor(config, now) {
  const d = config.display;
  const local = zonedParts(now, d.timezone).minutes;
  const night = inWindow(local, hhmmToMinutes(d.nightStart, 1320), hhmmToMinutes(d.nightEnd, 420));
  const pct = night ? d.nightBrightness : d.dayBrightness;
  return Math.round((pct / 100) * 255);
}

export function encodeBundle({ config, status, poll, stale, screens }, now = new Date()) {
  const parts = [];
  const header = Buffer.alloc(24);
  header.write("TKB1", 0, "ascii");
  header.writeUInt8(1, 4);
  header.writeUInt8(screens.length, 5);
  header.writeUInt16LE(poll, 6);
  header.writeUInt8(brightnessFor(config, now), 8);
  const flags =
    (stale ? 1 : 0) |
    (status === "open" ? 2 : 0) |
    (config.display.doubleTap ? 4 : 0) |
    (config.display.clock24h ? 8 : 0);
  header.writeUInt8(flags, 9);
  header.writeUInt16LE(config.display.dwellSeconds, 10);
  header.writeUInt32LE(Math.floor(now.getTime() / 1000), 12);
  header.writeInt16LE(utcOffsetMinutes(now, config.display.timezone), 16);
  parts.push(header);

  for (const s of screens) {
    const id = Buffer.from(s.id, "ascii");
    const strip = s.strip ?? null;
    const meta = Buffer.alloc(1 + id.length + 10);
    let o = 0;
    meta.writeUInt8(id.length, o++);
    id.copy(meta, o);
    o += id.length;
    meta.writeUInt8(s.clock ? s.clock.x : 255, o++);
    meta.writeUInt8(s.clock ? s.clock.y : 0, o++);
    meta.writeUInt16LE(s.clock ? s.clock.color : 0, o);
    o += 2;
    meta.writeUInt8(strip ? s.stripY : 0, o++);
    meta.writeUInt8(strip ? strip.height : 0, o++);
    meta.writeUInt16LE(strip ? strip.width : 0, o);
    o += 2;
    meta.writeUInt8(strip && strip.width > 64 ? s.scrollSpeed : 0, o++);
    meta.writeUInt8(0, o++);
    parts.push(meta, pixels(s.bg));
    if (strip) parts.push(pixels(strip));
  }
  return Buffer.concat(parts);
}

function pixels(canvas) {
  const b = Buffer.alloc(canvas.px.length * 2);
  canvas.px.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
