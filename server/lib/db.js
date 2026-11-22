// Minimal Supabase (PostgREST) client for the `ticker` schema, using fetch.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only secret).

const SCHEMA = "ticker";

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function dbConfigured() {
  return Boolean(process.env.LOCAL_DB || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY));
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

async function call(path, init) {
  if (process.env.LOCAL_DB) return localCall(path, init);
  if (!dbConfigured()) throw new Error("Supabase not configured");
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

// First row matching a PostgREST filter, e.g. dbGet("cache", "key=eq.quotes").
export async function dbGet(table, filter) {
  const rows = await call(`${table}?${filter}&limit=1`, { headers: headers() });
  return rows[0] ?? null;
}

export async function dbUpsert(table, row) {
  await call(table, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
}

// Small key/value helpers on ticker.cache, for last-good market data.
export async function cacheGet(key) {
  const row = await dbGet("cache", `key=eq.${encodeURIComponent(key)}`);
  return row ? { data: row.data, updatedAt: Date.parse(row.updated_at) } : null;
}

export async function cacheSet(key, data) {
  await dbUpsert("cache", { key, data, updated_at: new Date().toISOString() });
}
