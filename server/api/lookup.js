// GET /api/lookup?symbol=AAPL  (admin) -> current quote, to check a symbol before adding it
import { isAdmin, deny, json } from "../lib/auth.js";
import { lookupSymbol } from "../lib/market.js";

export default async function handler(req, res) {
  if (!isAdmin(req)) return deny(res);
  const symbol = (new URL(req.url, "http://x").searchParams.get("symbol") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.\-^]/g, "")
    .slice(0, 12);
  if (!symbol) return json(res, { error: "missing symbol" }, 400);
  try {
    const found = await lookupSymbol(symbol);
    json(res, found ? { symbol, ...found } : { error: `${symbol} not found` }, found ? 200 : 404);
  } catch (e) {
    json(res, { error: e.message }, 502);
  }
}
