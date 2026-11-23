// GET  /api/bundle?t=DEVICE_TOKEN    -> the binary screen bundle for the device (CDN-cached)
// GET  /api/bundle  (admin auth)     -> same, uncached, for the settings page preview
// POST /api/bundle  (admin auth)     -> render a draft config {config} without saving it
import { isDevice, isAdmin, deny, readJson } from "../lib/auth.js";
import { buildScreens, encodeBundle } from "../lib/bundle.js";
import { sanitizeConfig } from "../lib/config.js";

export default async function handler(req, res) {
  const device = isDevice(req);
  const admin = !device && isAdmin(req);
  if (!device && !admin) return deny(res);

  try {
    let config;
    if (req.method === "POST") {
      if (!admin) return deny(res);
      config = sanitizeConfig((await readJson(req)).config);
    }
    const now = new Date();
    const built = await buildScreens({ now, config });
    const body = encodeBundle(built, now);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", body.length);
    // Never cache: the header carries the server time the device's clock is
    // set from, so a cached copy makes the clock run behind by its age. Market
    // data has its own cache (lib/market.js), so this doesn't add API calls.
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch (e) {
    console.error("bundle failed", e);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    res.end("error");
  }
}
