// GET /api/config  (admin) -> settings + device status + which data sources are configured
// PUT /api/config  (admin) -> save settings (body: the config object)
import { isAdmin, deny, json, readJson } from "../lib/auth.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { dbGet, dbConfigured } from "../lib/db.js";
import { quoteProvider } from "../lib/market.js";

export default async function handler(req, res) {
  if (!isAdmin(req)) return deny(res);
  try {
    if (req.method === "PUT") {
      const saved = await saveConfig(await readJson(req));
      return json(res, { config: saved });
    }
    const [config, device] = await Promise.all([
      loadConfig({ fresh: true }),
      dbConfigured() ? dbGet("device", "main").catch(() => null) : null,
    ]);
    json(res, {
      config,
      device,
      sources: {
        database: dbConfigured(),
        quotes: quoteProvider(),
        fred: Boolean(process.env.FRED_KEY),
        twelvedata: Boolean(process.env.TWELVEDATA_KEY),
        deviceToken: Boolean(process.env.DEVICE_TOKEN),
      },
    });
  } catch (e) {
    console.error("config failed", e);
    json(res, { error: e.message }, 500);
  }
}
