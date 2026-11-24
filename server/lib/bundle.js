// Builds the TKB1 binary bundle described in docs/protocol.md.
import { loadConfig } from "./config.js";
import { getQuotes, getSp500, quoteProvider } from "./market.js";
import { marketStatus, pollSeconds, zonedParts, utcOffsetMinutes, hhmmToMinutes, inWindow, bellTimes } from "./hours.js";
import { renderScreens } from "./screens.js";
import { loadAnimation, decodeFrame } from "./animation.js";
import { bellId } from "./bell.js";
import { Canvas } from "./canvas.js";

// The device gets a bell event this long before it rings (so it has time to
// download it) and keeps it until shortly after.
const BELL_LEAD_S = 15 * 60;
const BELL_TAIL_S = 2 * 60;

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
  const events = fw >= 5 ? await bellEvents(config, now, q.quotes, { preview: fw >= 999 }) : [];
  // Poll every minute while a bell is coming up, so it's downloaded in time.
  const pollNow = events.some((e) => e.playAt) ? Math.min(poll, 60) : poll;
  return {
    config, status, poll: pollNow, stale, autoplayMinutes, events,
    screens: renderScreens(ctx), quotesUpdatedAt: q.updatedAt,
  };
}

// Opening/closing bell events (protocol kind 2) due around now, plus a test
// bell if one was requested from the settings page. In preview mode (the
// settings page) both bells are always included, unscheduled (playAt 0).
export async function bellEvents(config, now, quotes, { preview = false } = {}) {
  if (!config.display.bells && !config.display.testBellAt) return [];
  const t = Math.floor(now.getTime() / 1000);
  const spy = quotes?.SPY?.pct ?? null;
  const due = [];
  if (config.display.bells) {
    for (const b of bellTimes(now)) {
      if (preview || (t >= b.playAt - BELL_LEAD_S && t <= b.playAt + BELL_TAIL_S)) {
        due.push({ id: bellId(b.kind, b.kind === "close" ? spy : null), playAt: preview ? 0 : b.playAt });
      }
    }
    if (preview && !due.length) due.push({ id: "bell-o", playAt: 0 }, { id: bellId("close", spy), playAt: 0 });
  }
  const test = config.display.testBellAt;
  if (!preview && test && t >= test - BELL_LEAD_S && t <= test + BELL_TAIL_S) {
    due.push({ id: bellId("close", spy), playAt: test });
  }
  const out = [];
  for (const e of due) {
    const anim = await loadAnimation(e.id);
    if (!anim) continue;
    const bg = new Canvas(); // poster: the last (settled) frame
    bg.px.set(decodeFrame(anim.buf, anim.index.frames[anim.index.frames.length - 1]));
    out.push({ id: e.id, bg, playAt: e.playAt, asset: { id: anim.id, crc: anim.crc, size: anim.size } });
  }
  return out;
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

export function encodeBundle({ config, status, poll, stale, screens, autoplayMinutes = 0, events = [] }, now = new Date()) {
  const parts = [];
  const header = Buffer.alloc(24);
  header.write("TKB1", 0, "ascii");
  header.writeUInt8(1, 4);
  header.writeUInt8(screens.length + events.length, 5);
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

  for (const s of [...screens, ...events.map((e) => ({ ...e, kind: 2 }))]) {
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
    meta.writeUInt8(s.kind ?? (s.asset ? 1 : 0), o++); // kind: 0 still/scroll, 1 animation, 2 timed event
    parts.push(meta, pixels(s.bg));
    if (strip) parts.push(pixels(strip));
    if (s.asset) {
      const assetId = Buffer.from(s.asset.id, "ascii");
      const a = Buffer.alloc(9 + assetId.length + (s.kind === 2 ? 4 : 0));
      a.writeUInt32LE(s.asset.crc, 0);
      a.writeUInt32LE(s.asset.size, 4);
      a.writeUInt8(assetId.length, 8);
      assetId.copy(a, 9);
      if (s.kind === 2) a.writeUInt32LE(s.playAt, 9 + assetId.length); // when to play it (unix s; 0 = preview)
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
