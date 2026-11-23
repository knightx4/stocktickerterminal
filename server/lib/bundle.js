// Builds the TKB1 binary bundle described in docs/protocol.md.
import { loadConfig } from "./config.js";
import { getQuotes, getSp500, quoteProvider } from "./market.js";
import { marketStatus, pollSeconds, zonedParts, utcOffsetMinutes, hhmmToMinutes, inWindow } from "./hours.js";
import { renderScreens } from "./screens.js";
import { loadAnimation } from "./animation.js";

const STALE_AFTER_MS = 15 * 60 * 1000;

// Gathers config + data and renders every screen. Used by /api/bundle and tests.
export async function buildScreens({ now = new Date(), config, fw = 0 } = {}) {
  config = config ?? (await loadConfig());
  const wantsBirthday = config.screens.some((s) => s.id === "birthday" && s.enabled);
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
  const birthday = wantsBirthday ? await loadAnimation("birthday") : null;

  const quotesAge = now.getTime() - q.updatedAt;
  const stale = !q.ok && (status === "open" ? quotesAge > STALE_AFTER_MS : quotesAge > 24 * 3600e3);
  const ctx = {
    config, quotes: q.quotes, sp500, status, now, fw,
    demo: quoteProvider() === "demo",
    animations: birthday ? { birthday } : {},
  };
  // Autoplay on his birthday, but not overnight while the panel is dimmed.
  const autoplayMinutes =
    wantsBirthday && isBirthday(config, now) && !isNight(config, now) ? BIRTHDAY_AUTOPLAY_MINUTES : 0;
  return { config, status, poll, stale, autoplayMinutes, screens: renderScreens(ctx), quotesUpdatedAt: q.updatedAt };
}

// On his birthday the device plays the birthday animation on its own this often.
export const BIRTHDAY_AUTOPLAY_MINUTES = 5;

// True on the month/day of the "since" date (his birth date), in his time zone.
export function isBirthday(config, now) {
  const today = zonedParts(now, config.display.timezone).ymd.slice(5); // "MM-DD"
  return today === config.since1968.baseDate.slice(5);
}

export function isNight(config, now) {
  const d = config.display;
  const local = zonedParts(now, d.timezone).minutes;
  return inWindow(local, hhmmToMinutes(d.nightStart, 1320), hhmmToMinutes(d.nightEnd, 420));
}

export function brightnessFor(config, now) {
  const d = config.display;
  const pct = isNight(config, now) ? d.nightBrightness : d.dayBrightness;
  return Math.round((pct / 100) * 255);
}

export function encodeBundle({ config, status, poll, stale, screens, autoplayMinutes = 0 }, now = new Date()) {
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
  header.writeUInt8(autoplayMinutes, 18);
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
    meta.writeUInt8(s.asset ? 1 : 0, o++); // kind: 0 still/scroll, 1 animation
    parts.push(meta, pixels(s.bg));
    if (strip) parts.push(pixels(strip));
    if (s.asset) {
      const assetId = Buffer.from(s.asset.id, "ascii");
      const a = Buffer.alloc(9 + assetId.length);
      a.writeUInt32LE(s.asset.crc, 0);
      a.writeUInt32LE(s.asset.size, 4);
      a.writeUInt8(assetId.length, 8);
      assetId.copy(a, 9);
      parts.push(a);
    }
  }
  return Buffer.concat(parts);
}

function pixels(canvas) {
  const b = Buffer.alloc(canvas.px.length * 2);
  canvas.px.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
