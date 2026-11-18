// Локальный запуск без Netlify CLI: раздаёт public/ и направляет /api/* в функции,
// а данные хранит в локальном сервере Netlify Blobs (папка BLOB_DIR, по умолчанию .local-blobs).
import http from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const port = Number(process.argv[3] || 8888);
const { BlobsServer } = await import(pathToFileURL(path.join(root, "node_modules/@netlify/blobs/dist/server.js")).href);

const blobDir = path.join(process.env.BLOB_DIR || path.join(root, ".local-blobs"));
await mkdir(blobDir, { recursive: true });
const blobs = new BlobsServer({ directory: blobDir, token: "local-token", port: 0 });
const { port: bport } = await blobs.start();
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(
  JSON.stringify({ edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, siteID: "local", token: "local-token" }),
).toString("base64");
globalThis.Netlify = { env: { get: (k) => process.env[k] } };

const fn = async (name) => (await import(pathToFileURL(path.join(root, "netlify/functions", name + ".mts")).href)).default;
const handlers = {
  public: await fn("public"), cabinet: await fn("cabinet"), admin: await fn("admin"),
  telegram: await fn("telegram"), whatsapp: await fn("whatsapp"),
  // плановые функции локально запускаются вручную: GET /__cron/digest, /__cron/reminders
  digest: await fn("digest"), reminders: await fn("reminders"),
};

function route(p) {
  let m;
  if ((m = p.match(/^\/api\/public\/([^/]+)(\/logo)?$/))) return ["public", { center: decodeURIComponent(m[1]) }];
  if (["/api/chat", "/api/book", "/api/login"].includes(p)) return ["public", {}];
  if (p.startsWith("/api/cabinet/")) return ["cabinet", {}];
  if (p.startsWith("/api/admin/")) return ["admin", {}];
  if (p === "/api/telegram/webhook") return ["telegram", {}];
  if (p === "/api/whatsapp/webhook") return ["whatsapp", {}];
  if (p === "/__cron/digest") return ["digest", {}];
  if (p === "/__cron/reminders") return ["reminders", {}];
  return null;
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const r = route(url.pathname);
  try {
    if (r) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const t0 = Date.now();
      const response = (await handlers[r[0]](request, { params: r[1], ip: "127.0.0.1" })) ?? new Response("done");
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      console.log(req.method, url.pathname, response.status, `${Date.now() - t0}ms`);
      return;
    }
    let file = path.join(root, "public", decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, "public"))) throw new Error("bad path");
    const st = await stat(file).catch(() => null);
    if (st?.isDirectory()) file = path.join(file, "index.html");
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e.code !== "ENOENT") console.error(e);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`dev on http://localhost:${port}, blobs on ${bport}`));
