// Market data with caching and fallbacks.
//   Quotes:  Finnhub (FINNHUB_KEY), fallback Twelve Data (TWELVEDATA_KEY),
//            demo data if neither key is set.
//   S&P 500 level: FRED series SP500 (FRED_KEY), daily closes.
// Last good results are kept in Supabase (ticker.cache) so an upstream outage
// shows slightly old data instead of nothing.
import { cacheGet, cacheSet, dbConfigured } from "./db.js";
import { HISTORY } from "../data/sp500-monthly.js";

// ETFs used for the day's index moves, with the label shown on screen.
export const INDEX_ETFS = { SPY: "S&P", DIA: "DOW", QQQ: "NASDAQ" };

// Accept the common misspelling too, so a typo in Vercel doesn't silently mean demo data.
const finnhubKey = () => process.env.FINNHUB_KEY || process.env.FINHUB_KEY;

const mem = new Map(); // per-instance cache: key -> { data, updatedAt }

async function cached(key, ttlMs, fetcher) {
  const now = Date.now();
  let hit = mem.get(key);
  if (!hit && dbConfigured()) {
    try {
      hit = await cacheGet(key);
      if (hit) mem.set(key, hit);
    } catch (e) {
      console.error("cacheGet", key, e.message);
    }
  }
  if (hit && now - hit.updatedAt < ttlMs && (!fetcher.accepts || fetcher.accepts(hit.data))) {
    return { data: hit.data, updatedAt: hit.updatedAt, fresh: true };
  }
  try {
    const data = await fetcher(hit?.data);
    const entry = { data, updatedAt: now };
    mem.set(key, entry);
    if (dbConfigured()) cacheSet(key, data).catch((e) => console.error("cacheSet", key, e.message));
    return { ...entry, fresh: true };
  } catch (e) {
    console.error("fetch failed", key, e.message);
    if (hit) return { data: hit.data, updatedAt: hit.updatedAt, fresh: false, error: e.message };
    throw e;
  }
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- quotes

async function finnhubQuote(symbol) {
  const j = await getJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey()}`
  );
  if (!j || !j.c) return null; // unknown symbol
  return { price: j.c, change: j.d ?? 0, pct: j.dp ?? 0, prevClose: j.pc ?? 0, t: j.t ?? 0 };
}

async function twelveDataQuotes(symbols) {
  const j = await getJson(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${process.env.TWELVEDATA_KEY}`
  );
  const list = symbols.length === 1 ? { [symbols[0]]: j } : j;
  const out = {};
  for (const s of symbols) {
    const q = list[s];
    if (!q || q.status === "error" || !q.close) continue;
    out[s] = {
      price: Number(q.close),
      change: Number(q.change),
      pct: Number(q.percent_change),
      prevClose: Number(q.previous_close),
      t: Number(q.timestamp) || 0,
    };
  }
  return out;
}

function demoQuote(symbol) {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = 20 + (h % 900);
  const pct = Math.sin(h + Date.now() / 3.6e6) * 2.5;
  const price = Math.round(base * (1 + pct / 100) * 100) / 100;
  return { price, change: Math.round((price - base) * 100) / 100, pct: Math.round(pct * 100) / 100, prevClose: base, t: 0 };
}

export function quoteProvider() {
  if (finnhubKey()) return "finnhub";
  if (process.env.TWELVEDATA_KEY) return "twelvedata";
  return "demo";
}

// Fetch every symbol; keep the previous value for any symbol that fails.
async function fetchQuotes(symbols, previous = {}) {
  const provider = quoteProvider();
  if (provider === "demo") return Object.fromEntries(symbols.map((s) => [s, demoQuote(s)]));


  let fresh = {};
  if (provider === "finnhub") {
    const results = await Promise.allSettled(symbols.map(finnhubQuote));
    results.forEach((r, i) => r.status === "fulfilled" && r.value && (fresh[symbols[i]] = r.value));
    const missing = symbols.filter((s) => !fresh[s]);
    if (missing.length && process.env.TWELVEDATA_KEY) {
      try {
        Object.assign(fresh, await twelveDataQuotes(missing.slice(0, 8)));
      } catch (e) {
        console.error("twelvedata fallback", e.message);
      }
    }
  } else {
    fresh = await twelveDataQuotes(symbols.slice(0, 8));
  }
  if (!Object.keys(fresh).length) throw new Error(`${provider}: no quotes returned`);
  const out = { ...previous, ...fresh };
  for (const s of symbols) if (!(s in out)) out[s] = null; // unknown symbol: remember, don't refetch
  return out;
}

export async function getQuotes(symbols, ttlSeconds) {
  const wanted = [...new Set([...symbols, ...Object.keys(INDEX_ETFS)])];
  const fetcher = (prev) => fetchQuotes(wanted, prev || {});
  // Refetch early if a newly added symbol isn't in the cache yet.
  fetcher.accepts = (data) => wanted.every((s) => s in data);
  const r = await cached(`quotes:${quoteProvider()}`, ttlSeconds * 1000, fetcher);
  return { quotes: r.data, updatedAt: r.updatedAt, ok: r.fresh, provider: quoteProvider() };
}

// Single lookup for the admin page's "add symbol" check.
// Returns { quote, name } or null if the symbol doesn't exist.
export async function lookupSymbol(symbol) {
  const p = quoteProvider();
  if (p === "demo") return { quote: demoQuote(symbol), name: "" };
  if (p === "finnhub") {
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey()}`;
    const [quote, profile] = await Promise.all([
      finnhubQuote(symbol),
      getJson(profileUrl).catch(() => ({})),
    ]);
    return quote ? { quote, name: profile?.name || "" } : null;
  }
  const quote = (await twelveDataQuotes([symbol]))[symbol];
  return quote ? { quote, name: "" } : null;
}

// ---------------------------------------------------------------- S&P 500 level

// Monthly history (static, from Shiller/datahub), then FRED for recent months
// and the latest daily close.
export async function getSp500() {
  const lastStatic = HISTORY.months[HISTORY.months.length - 1];
  const fallback = {
    months: HISTORY.months,
    latest: { date: `${lastStatic[0]}-01`, value: lastStatic[1] },
    source: "history",
  };
  if (!process.env.FRED_KEY) return { ...fallback, ok: true };

  const fetcher = async () => {
    const key = process.env.FRED_KEY;
    const base = "https://api.stlouisfed.org/fred/series/observations?series_id=SP500&file_type=json";
    const [daily, monthly] = await Promise.all([
      getJson(`${base}&api_key=${key}&sort_order=desc&limit=10`),
      getJson(`${base}&api_key=${key}&frequency=m&aggregation_method=avg&observation_start=${nextMonth(lastStatic[0])}-01`),
    ]);
    const latest = daily.observations.find((o) => o.value !== ".");
    if (!latest) throw new Error("FRED: no recent SP500 value");
    const extra = monthly.observations
      .filter((o) => o.value !== ".")
      .map((o) => [o.date.slice(0, 7), Number(o.value)]);
    return { extra, latest: { date: latest.date, value: Number(latest.value) } };
  };
  try {
    const r = await cached("sp500", 6 * 3600 * 1000, fetcher);
    return { months: [...HISTORY.months, ...r.data.extra], latest: r.data.latest, source: "fred", ok: r.fresh };
  } catch {
    return { ...fallback, ok: false };
  }
}

function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

