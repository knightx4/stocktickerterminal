// Minimal Supabase client for the `ticker` schema, using fetch.
// The server uses the project's publishable key plus TICKER_DB_SECRET: the
// tables are closed to that key, and two database functions (get_row,
// put_row) open them only when the secret matches. See supabase/ticker.sql.
//   SUPABASE_URL, SUPABASE_KEY (publishable), TICKER_DB_SECRET

const SCHEMA = "ticker";

function headers() {
  return {
    apikey: process.env.SUPABASE_KEY,
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    "Content-Type": "application/json",
  };
}

export function dbConfigured() {
  return Boolean(
    process.env.LOCAL_DB ||
      (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.TICKER_DB_SECRET)
  );
}

// LOCAL_DB=./local-db.json stores everything in a file instead (local dev only).
async function localCall(path, init) {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const file = process.env.LOCAL_DB;
  const db = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const [table, query = ""] = path.split("?");
  db[table] ??= [];
  if (init?.method === "POST") {
    const row = JSON.parse(init.body);
    const pk = "id" in row ? "id" : "key";
    db[table] = db[table].filter((r) => r[pk] !== row[pk]).concat(row);
    writeFileSync(file, JSON.stringify(db, null, 2));
    return null;
  }
  const m = /(\w+)=eq\.([^&]+)/.exec(query);
  return db[table].filter((r) => !m || String(r[m[1]]) === decodeURIComponent(m[2]));
}

async function rpc(fn, args) {
  if (!dbConfigured()) throw new Error("Supabase not configured");
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_token: process.env.TICKER_DB_SECRET, ...args }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const PK = { config: "id", device: "id", cache: "key" };
const PAYLOAD = { config: "data", device: "info", cache: "data" };

// One row by primary key, e.g. dbGet("cache", "quotes"). Returns null if missing.
export async function dbGet(table, id) {
  if (process.env.LOCAL_DB) {
    const rows = await localCall(`${table}?${PK[table]}=eq.${encodeURIComponent(id)}`);
    return rows[0] ?? null;
  }
  return rpc("get_row", { p_table: table, p_id: String(id) });
}

// Insert or replace a row's payload (config.data, device.info, cache.data).
export async function dbPut(table, id, payload) {
  if (process.env.LOCAL_DB) {
    const now = new Date().toISOString();
    const row = { [PK[table]]: id, [PAYLOAD[table]]: payload, updated_at: now, last_seen: now };
    return localCall(table, { method: "POST", body: JSON.stringify(row) });
  }
  return rpc("put_row", { p_table: table, p_id: String(id), p_data: payload });
}

// Small key/value helpers on ticker.cache, for last-good market data.
export async function cacheGet(key) {
  const row = await dbGet("cache", key);
  return row ? { data: row.data, updatedAt: Date.parse(row.updated_at) } : null;
}

export async function cacheSet(key, data) {
  await dbPut("cache", key, data);
}
