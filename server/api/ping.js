// POST /api/ping?t=DEVICE_TOKEN  - device heartbeat; replies with a firmware offer.
import { isDevice, deny, json, readJson } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";
import { dbUpsert, dbConfigured } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST" || !isDevice(req)) return deny(res);
  let info = {};
  try {
    const body = await readJson(req);
    // keep only small, known fields
    for (const k of ["fw", "uptime", "rssi", "heap", "screen", "ip", "reset", "err"]) {
      if (k in body) info[k] = typeof body[k] === "string" ? body[k].slice(0, 200) : body[k];
    }
  } catch {
    info = { err: "bad heartbeat body" };
  }
  if (dbConfigured()) {
    await dbUpsert("device", { id: "main", last_seen: new Date().toISOString(), info }).catch((e) =>
      console.error("heartbeat save failed", e.message)
    );
  }
  const { firmware } = await loadConfig();
  json(res, { firmware: firmware.version && firmware.url && firmware.md5 ? firmware : null });
}
