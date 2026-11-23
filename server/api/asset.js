// GET /api/asset?id=birthday&t=DEVICE_TOKEN  (or admin auth)
// -> the raw TKA1 animation. Fetched once by the device; private (family
// photos), so it is never cached by the CDN.
import { isDevice, isAdmin, deny, json } from "../lib/auth.js";
import { loadAnimation } from "../lib/animation.js";

export default async function handler(req, res) {
  if (!isDevice(req) && !isAdmin(req)) return deny(res);
  const id = (new URL(req.url, "http://x").searchParams.get("id") || "").replace(/[^a-z0-9_-]/gi, "");
  const anim = id ? await loadAnimation(id) : null;
  if (!anim) return json(res, { error: "not found" }, 404);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", anim.size);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(anim.buf);
}
