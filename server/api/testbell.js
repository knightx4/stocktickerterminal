// POST /api/testbell  (admin) -> ring a test closing bell on the device ~75 s from now.
import { isAdmin, deny, json } from "../lib/auth.js";
import { loadConfig, saveConfig } from "../lib/config.js";

export default async function handler(req, res) {
  if (req.method !== "POST" || !isAdmin(req)) return deny(res);
  try {
    const config = await loadConfig({ fresh: true });
    const at = Math.floor(Date.now() / 1000) + 75;
    await saveConfig({ ...config, display: { ...config.display, testBellAt: at } });
    json(res, { testBellAt: at });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}
