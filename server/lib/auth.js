// Two secrets, both Vercel env vars:
//   DEVICE_TOKEN   - sent by the device as ?t=... (lets it read screens, send heartbeats)
//   ADMIN_PASSWORD - typed into the settings page, sent as "Authorization: Bearer ..."
import { timingSafeEqual, createHash } from "node:crypto";

function same(a, b) {
  if (!a || !b) return false;
  const h = (s) => createHash("sha256").update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
}

export function isDevice(req) {
  const t = new URL(req.url, "http://x").searchParams.get("t");
  return same(t, process.env.DEVICE_TOKEN);
}

export function isAdmin(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return same(m?.[1], process.env.ADMIN_PASSWORD);
}

export function deny(res, status = 401) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: status === 401 ? "unauthorized" : "error" }));
}

export function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// Reads a JSON request body (Vercel may already have parsed it).
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > 100_000) throw new Error("body too large");
  return text ? JSON.parse(text) : {};
}
