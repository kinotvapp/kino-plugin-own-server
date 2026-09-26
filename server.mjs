#!/usr/bin/env node
// A tiny stand-in for a home media server (the shape a Jellyfin/Emby/NAS-style API takes), so
// plugin.js has something real to talk to. No dependencies -- just node:http and node:fs.
//
//   node server.mjs [--port 8096] [--user ana] [--password s3cr3t]
//
// Then, from this folder, using your computer's own LAN address (Kino refuses a loopback address
// even from the kit -- see README.md, "Why not 127.0.0.1"):
//   node sdk/run.mjs . --config server=http://192.168.1.10:8096 \
//   --config user=ana --config password=s3cr3t home
//
// Five catalog entries are named after the error they trigger when opened (`resolve`), the same
// five kino.error() codes the guide documents -- open "Error: limitado" and you get rate_limited,
// and so on. "Video de prueba 1" is the only one that actually streams (media/video1.mp4, bundled).
//
// Tokens: issued on a correct login and kept until this process exits -- this server never expires
// or revokes one, so changing only the password in Kino's Configurar screen does NOT by itself force
// a new login; the still-cached token keeps working (see README.md, "About the bundled token").

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.flatMap((a, i) => (a.startsWith("--") ? [[a.slice(2), argv[i + 1]]] : [])),
);
const PORT = Number(args.port) || 8096;
const USER = args.user || "ana";
const PASSWORD = args.password || "s3cr3t";

const here = dirname(fileURLToPath(import.meta.url));
const videoPath = join(here, "media", "video1.mp4");

const CATALOG = [
  { id: "v1", title: "Video de prueba 1", year: 2024, stream: "/stream/v1" },
  { id: "err-404", title: "Error: no encontrado", errorStatus: 404 },
  { id: "err-429", title: "Error: limitado", errorStatus: 429 },
  { id: "err-451", title: "Error: región", errorStatus: 451 },
  { id: "err-503", title: "Error: no disponible", errorStatus: 503 },
];

const tokens = new Set();

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": buf.length });
  res.end(buf);
}

function authed(req) {
  return tokens.has(req.headers["x-token"]);
}

// A 1x1 placeholder poster, generated once: nobody needs a real image to see the plugin work.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function streamVideo(req, res) {
  let size;
  try {
    size = statSync(videoPath).size;
  } catch {
    return json(res, 500, { error: "media/video1.mp4 is missing -- see README.md" });
  }
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": size, "Accept-Ranges": "bytes" });
    return createReadStream(videoPath).pipe(res);
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  res.writeHead(206, {
    "Content-Type": "video/mp4",
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
  });
  createReadStream(videoPath, { start, end }).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  console.log(req.method, url.pathname + url.search);

  if (req.method === "POST" && url.pathname === "/auth") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { user, password } = JSON.parse(body || "{}");
      if (user !== USER || password !== PASSWORD) return json(res, 401, { error: "bad credentials" });
      const token = randomBytes(16).toString("hex");
      tokens.add(token);
      json(res, 200, { token });
    });
    return;
  }

  if (url.pathname === "/items" && !authed(req)) return json(res, 401, { error: "no token" });

  if (req.method === "GET" && url.pathname === "/items") {
    const limit = Number(url.searchParams.get("limit")) || 10;
    const cursor = Number(url.searchParams.get("cursor")) || 0;
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const pool = q ? CATALOG.filter((x) => x.title.toLowerCase().includes(q)) : CATALOG;
    const page = pool.slice(cursor, cursor + limit);
    const next = cursor + limit < pool.length ? String(cursor + limit) : undefined;
    return json(res, 200, { items: page.map(({ id, title, year }) => ({ id, title, year })), next });
  }

  const itemMatch = /^\/items\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && itemMatch) {
    if (!authed(req)) return json(res, 401, { error: "no token" });
    const item = CATALOG.find((x) => x.id === decodeURIComponent(itemMatch[1]));
    if (!item) return json(res, 404, { error: "not found" });
    if (item.errorStatus) return json(res, item.errorStatus, { error: "demo error " + item.errorStatus });
    return json(res, 200, item);
  }

  if (req.method === "GET" && url.pathname.startsWith("/img/")) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PLACEHOLDER_PNG.length });
    return res.end(PLACEHOLDER_PNG);
  }

  if (req.method === "GET" && url.pathname === "/stream/v1") return streamVideo(req, res);

  json(res, 404, { error: "no route" });
});

server.listen(PORT, () => {
  console.log(`Mi servidor (reference) listening on http://127.0.0.1:${PORT} -- user "${USER}"`);
});
