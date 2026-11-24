// Settings: defaults, validation, and load/save in Supabase (ticker.config).
import { dbGet, dbPut } from "./db.js";

export const SCREEN_IDS = ["ticker", "since1968", "indices", "birthday", "message", "firm"];

export const DEFAULT_CONFIG = {
  symbols: [
    { symbol: "AAPL" }, { symbol: "MSFT" }, { symbol: "NVDA" }, { symbol: "AMZN" },
    { symbol: "GOOGL" }, { symbol: "META" }, { symbol: "BRK.B" }, { symbol: "JPM" },
  ],
  screens: [
    { id: "ticker", enabled: true },
    { id: "since1968", enabled: true },
    { id: "indices", enabled: true },
    { id: "birthday", enabled: true },
    { id: "message", enabled: false },
    { id: "firm", enabled: false },
  ],
  messages: [{ text: "HAPPY\nBIRTHDAY\nDAD!", color: "#ffb000" }],
  firm: { title: "FIRM AUM", value: "$0M", goal: "$100M", percent: 0, color: "#3c8cff" },
  since1968: { baseDate: "1968-11-27", baseValue: 107.76, scale: "linear" },
  display: {
    timezone: "America/Chicago",
    dayBrightness: 70,
    nightBrightness: 12,
    nightStart: "22:00",
    nightEnd: "07:00",
    dwellSeconds: 0,
    scrollSpeed: 20,
    clock24h: false,
    doubleTap: true,
    bells: true,
    testBellAt: 0, // unix seconds: ring a test bell then (set from the settings page)
  },
  firmware: { version: 0, url: "", md5: "" },
};

const str = (v, max, d = "") => (typeof v === "string" ? v.slice(0, max) : d);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : d);
const hhmm = (v, d) => (/^\d{1,2}:\d{2}$/.test(v || "") ? v : d);

// Returns a complete, safe config from any (possibly partial or hostile) input.
export function sanitizeConfig(input) {
  const c = input && typeof input === "object" ? input : {};
  const D = DEFAULT_CONFIG;

  const symbols = (Array.isArray(c.symbols) ? c.symbols : D.symbols)
    .map((s) => ({
      symbol: str(s?.symbol, 12).toUpperCase().replace(/[^A-Z0-9.\-^]/g, ""),
      label: str(s?.label, 8).toUpperCase(),
    }))
    .filter((s) => s.symbol)
    .slice(0, 25); // stays well inside the free API rate limit

  const seen = new Set();
  const screens = (Array.isArray(c.screens) ? c.screens : [])
    .filter((s) => SCREEN_IDS.includes(s?.id) && !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({ id: s.id, enabled: bool(s.enabled, true) }));
  for (const s of D.screens) if (!seen.has(s.id)) screens.push({ ...s });

  const messages = (Array.isArray(c.messages) ? c.messages : D.messages)
    .map((m) => ({ text: str(m?.text, 200), color: color(m?.color, "#ffb000") }))
    .filter((m) => m.text.trim())
    .slice(0, 10);

  const f = c.firm || {};
  const s68 = c.since1968 || {};
  const d = c.display || {};
  const fw = c.firmware || {};

  return {
    symbols,
    screens,
    messages,
    firm: {
      title: str(f.title, 16, D.firm.title),
      value: str(f.value, 10, D.firm.value),
      goal: str(f.goal, 12, D.firm.goal),
      percent: num(f.percent, 0, 999, 0),
      color: color(f.color, D.firm.color),
    },
    since1968: {
      baseDate: /^\d{4}-\d{2}-\d{2}$/.test(s68.baseDate || "") ? s68.baseDate : D.since1968.baseDate,
      baseValue: num(s68.baseValue, 0.01, 1e6, D.since1968.baseValue),
      scale: s68.scale === "log" ? "log" : "linear",
    },
    display: {
      timezone: isValidTimeZone(d.timezone) ? d.timezone : D.display.timezone,
      dayBrightness: num(d.dayBrightness, 1, 100, D.display.dayBrightness),
      nightBrightness: num(d.nightBrightness, 0, 100, D.display.nightBrightness),
      nightStart: hhmm(d.nightStart, D.display.nightStart),
      nightEnd: hhmm(d.nightEnd, D.display.nightEnd),
      dwellSeconds: num(d.dwellSeconds, 0, 3600, 0),
      scrollSpeed: num(d.scrollSpeed, 5, 60, D.display.scrollSpeed),
      clock24h: bool(d.clock24h, false),
      doubleTap: bool(d.doubleTap, true),
      bells: bool(d.bells, true),
      testBellAt: Math.round(num(d.testBellAt, 0, 4e9, 0)),
    },
    firmware: {
      version: Math.round(num(fw.version, 0, 65535, 0)),
      url: /^https:\/\//.test(fw.url || "") ? str(fw.url, 500) : "",
      md5: /^[0-9a-f]{32}$/i.test(fw.md5 || "") ? fw.md5.toLowerCase() : "",
    },
  };
}

function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Short in-memory cache so a burst of requests doesn't hit the database.
let cached = null;
let cachedAt = 0;

export async function loadConfig({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < 30_000) return cached;
  try {
    const row = await dbGet("config", 1);
    cached = sanitizeConfig(row?.data && Object.keys(row.data).length ? row.data : DEFAULT_CONFIG);
    cachedAt = Date.now();
  } catch (e) {
    console.error("loadConfig failed, using", cached ? "last good" : "defaults", e.message);
    if (!cached) return sanitizeConfig(DEFAULT_CONFIG);
  }
  return cached;
}

export async function saveConfig(input) {
  const clean = sanitizeConfig(input);
  await dbPut("config", 1, clean);
  cached = clean;
  cachedAt = Date.now();
  return clean;
}
