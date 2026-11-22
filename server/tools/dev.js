// Local dev server: serves public/ and the api/ functions on http://localhost:3000
//   ADMIN_PASSWORD=test DEVICE_TOKEN=dev LOCAL_DB=./local-db.json node tools/dev.js
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (path.startsWith("/api/")) {
      const mod = await import(join(root, `${path}.js`));
      return await mod.default(req, res);
    }
    const file = join(root, "public", path === "/" ? "index.html" : path);
    if (!file.startsWith(join(root, "public"))) throw new Error("bad path");
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch (e) {
    res.statusCode = 404;
    res.end(String(e.message));
  }
}).listen(3000, () => console.log("http://localhost:3000"));
