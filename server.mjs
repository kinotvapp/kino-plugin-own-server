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
// The catalog exercises every feature of the plugin SDK (README.md, "What each title shows"):
//   - movies that stream a progressive mp4 (so they can be downloaded), one of them with a TMDB id;
//   - a movie with a separate audio file (a "dub" the player merges into the video);
//   - a series whose two seasons are separate titles (the plugin answers `seasons`);
//   - a live channel: an endless HLS playlist looping six bundled 2-second segments;
//   - four entries named after the error they trigger when opened, the same kino.error() codes the
//     guide documents -- open "Error: limitado" and you get rate_limited, and so on.
//
// Search is deliberately naive: it matches ANY word of the query (3+ letters), the way many real
// backends do, so the plugin has something for kino.rank to clean up.
//
// Tokens: issued on a correct login and kept until this process exits -- this server never expires
// or revokes one, so changing only the password in Kino's Configurar screen does NOT by itself force
// a new login; the still-cached token keeps working (see README.md, "About the bundled token").
// Media URLs (/stream/*, /live/*, /img/*) need no token: the player fetches them without one.
//
// Artwork: every title gets its own poster (2:3) and backdrop (16:9), each episode a still, drawn
// on request by artwork.mjs -- a colour per title with its name on it, so the cards fill in.

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { artwork, SHAPES } from "./artwork.mjs";

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.flatMap((a, i) => (a.startsWith("--") ? [[a.slice(2), argv[i + 1]]] : [])),
);
const PORT = Number(args.port) || 8096;
const USER = args.user || "ana";
const PASSWORD = args.password || "s3cr3t";

const here = dirname(fileURLToPath(import.meta.url));
const media = (name) => join(here, "media", name);

// Progressive files served with Range support: what the player streams and what a download saves.
const FILES = {
  v1: { path: media("video1.mp4"), mime: "video/mp4" },
  // 45 s, long enough to open the audio menu by hand: a steady low tone as its own audio...
  doblaje: { path: media("doblaje.mp4"), mime: "video/mp4" },
  // ...and the "dub", 45 s of a fast high beep, so switching tracks is unmistakable.
  "audio-es": { path: media("audio-es.m4a"), mime: "audio/mp4" },
};

// The live channel: six 2-second MPEG-TS segments (media/live/seg0.ts .. seg5.ts), looped forever.
const LIVE_SEGMENTS = 6;
const LIVE_SEGMENT_SECONDS = 2;
const LIVE_WINDOW = 5;

// One show, two seasons -- each season its own title, the way many servers keep them.
const SHOWS = {
  serie: { title: "Serie de prueba", overview: "Una serie de prueba con dos temporadas." },
};

const CATALOG = [
  { id: "v1", kind: "movie", title: "Video de prueba 1", year: 2024, stream: "v1" },
  { id: "bbb", kind: "movie", title: "Big Buck Bunny", year: 2008, tmdb: 10378, stream: "v1" },
  {
    id: "doblaje", kind: "movie", title: "Película con doblaje", year: 2025, stream: "doblaje",
    audio: [{ lang: "es-419", label: "Español (doblaje de prueba)", file: "audio-es" }],
  },
  {
    id: "serie-t1", kind: "series", title: "Serie de prueba", year: 2025, show: "serie", season: 1,
    episodes: ["El comienzo", "La prueba", "El final de temporada"],
  },
  {
    id: "serie-t2", kind: "series", title: "Serie de prueba (Temporada 2)", year: 2026, show: "serie", season: 2,
    episodes: ["El regreso", "Hasta la próxima"],
  },
  { id: "canal-1", kind: "live", title: "Canal de prueba" },
  { id: "err-404", kind: "movie", title: "Error: no encontrado", errorStatus: 404 },
  { id: "err-429", kind: "movie", title: "Error: limitado", errorStatus: 429 },
  { id: "err-451", kind: "movie", title: "Error: región", errorStatus: 451 },
  { id: "err-503", kind: "movie", title: "Error: no disponible", errorStatus: 503 },
];

// Every episode, by id ("serie-t1-e2"): playable like a movie.
const EPISODES = new Map(
  CATALOG.filter((x) => x.kind === "series").flatMap((s) =>
    s.episodes.map((title, i) => [
      `${s.id}-e${i + 1}`,
      { id: `${s.id}-e${i + 1}`, kind: "episode", title, season: s.season, number: i + 1, stream: "v1" },
    ]),
  ),
);

const tokens = new Set();

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": buf.length });
  res.end(buf);
}

function authed(req) {
  return tokens.has(req.headers["x-token"]);
}

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

// Any shared word is a hit: noisy on purpose (see the header comment).
function matches(item, q) {
  const title = new Set(words(item.title));
  return words(q).some((w) => title.has(w));
}

// What a listing shows of an entry.
const summary = ({ id, kind, title, year, tmdb }) => ({ id, kind, title, year, tmdb });

// What opening an entry shows: streams as server paths, a season with its episodes and siblings.
function detail(x) {
  if (x.kind === "movie" || x.kind === "episode") {
    return {
      id: x.id, kind: x.kind, title: x.title, stream: "/stream/" + x.stream,
      audio: (x.audio || []).map((a) => ({ lang: a.lang, label: a.label, stream: "/stream/" + a.file })),
    };
  }
  if (x.kind === "live") return { id: x.id, kind: "live", title: x.title, stream: "/live/" + x.id + ".m3u8" };
  const show = SHOWS[x.show];
  return {
    id: x.id, kind: "series", show: { id: x.show, ...show }, season: x.season,
    episodes: x.episodes.map((title, i) => ({ id: `${x.id}-e${i + 1}`, number: i + 1, title })),
    seasons: CATALOG.filter((s) => s.show === x.show).map((s) => ({ id: s.id, number: s.season })),
  };
}

// The small label on top of a title's artwork.
function artLabel(x) {
  if (x.kind === "series") return "Serie - Temporada " + x.season;
  if (x.kind === "episode") return `T${x.season} - Episodio ${x.number}`;
  if (x.kind === "live") return "En vivo";
  return "Pelicula";
}

// Drawn once per shape and id, then kept: the same URL always answers the same bytes.
const images = new Map();
function image(shape, id) {
  const key = shape + "/" + id;
  if (!images.has(key)) {
    const x = CATALOG.find((c) => c.id === id) || EPISODES.get(id);
    if (!x) return null;
    images.set(key, artwork({ id, title: x.title, label: artLabel(x), shape }));
  }
  return images.get(key);
}

function streamFile(req, res, { path, mime }) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return json(res, 500, { error: path + " is missing -- see README.md" });
  }
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "Content-Type": mime, "Content-Length": size, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    return createReadStream(path).pipe(res);
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, {
    "Content-Type": mime,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(path, { start, end }).pipe(res);
}

// A live HLS playlist computed from the clock: the newest LIVE_WINDOW segments, never an
// #EXT-X-ENDLIST, and an #EXT-X-DISCONTINUITY each time the loop starts over (the timestamps reset).
function livePlaylist(res) {
  const newest = Math.floor(Date.now() / 1000 / LIVE_SEGMENT_SECONDS);
  const first = newest - LIVE_WINDOW + 1;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${LIVE_SEGMENT_SECONDS}`,
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / LIVE_SEGMENTS)}`,
  ];
  for (let seq = first; seq <= newest; seq++) {
    if (seq !== first && seq % LIVE_SEGMENTS === 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${LIVE_SEGMENT_SECONDS}.000,`, `canal-1/${seq}.ts`);
  }
  const buf = Buffer.from(lines.join("\n") + "\n");
  res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": buf.length, "Cache-Control": "no-cache" });
  res.end(buf);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  console.log(req.method, url.pathname + url.search);

  if (req.method === "POST" && url.pathname === "/auth") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let creds = {};
      try { creds = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
      if (creds.user !== USER || creds.password !== PASSWORD) return json(res, 401, { error: "bad credentials" });
      const token = randomBytes(16).toString("hex");
      tokens.add(token);
      json(res, 200, { token });
    });
    return;
  }

  const read = req.method === "GET" || req.method === "HEAD";

  if (read && url.pathname === "/items") {
    if (!authed(req)) return json(res, 401, { error: "no token" });
    const limit = Number(url.searchParams.get("limit")) || 10;
    const cursor = Number(url.searchParams.get("cursor")) || 0;
    const q = url.searchParams.get("q") || "";
    const kind = url.searchParams.get("kind");
    const pool = CATALOG.filter((x) => (!kind || x.kind === kind) && (!q || matches(x, q)));
    const page = pool.slice(cursor, cursor + limit);
    const next = cursor + limit < pool.length ? String(cursor + limit) : undefined;
    return json(res, 200, { items: page.map(summary), next });
  }

  const itemMatch = /^\/items\/([^/]+)$/.exec(url.pathname);
  if (read && itemMatch) {
    if (!authed(req)) return json(res, 401, { error: "no token" });
    const id = decodeURIComponent(itemMatch[1]);
    const item = CATALOG.find((x) => x.id === id) || EPISODES.get(id);
    if (!item) return json(res, 404, { error: "not found" });
    if (item.errorStatus) return json(res, item.errorStatus, { error: "demo error " + item.errorStatus });
    return json(res, 200, detail(item));
  }

  // /img/poster/<id>.png, /img/backdrop/<id>.png (also an episode's still); /img/<id> is the
  // poster, the URL plugin 1.1.0 and earlier asked for.
  const imgMatch = /^\/img\/(?:([a-z]+)\/([^/]+)\.png|([^/]+))$/.exec(url.pathname);
  const shape = imgMatch && (imgMatch[1] || "poster");
  if (read && imgMatch && SHAPES[shape]) {
    const png = image(shape, decodeURIComponent(imgMatch[2] || imgMatch[3]));
    if (!png) return json(res, 404, { error: "no such title" });
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "max-age=86400" });
    return res.end(req.method === "HEAD" ? undefined : png);
  }

  const fileMatch = /^\/stream\/([^/]+)$/.exec(url.pathname);
  if (read && fileMatch && FILES[fileMatch[1]]) return streamFile(req, res, FILES[fileMatch[1]]);

  if (read && url.pathname === "/live/canal-1.m3u8") return livePlaylist(res);

  const segMatch = /^\/live\/canal-1\/(\d+)\.ts$/.exec(url.pathname);
  if (read && segMatch) {
    const file = media(`live/seg${Number(segMatch[1]) % LIVE_SEGMENTS}.ts`);
    return streamFile(req, res, { path: file, mime: "video/mp2t" });
  }

  json(res, 404, { error: "no route" });
});

// The addresses a phone on the same network can type in Configurar (never 127.0.0.1).
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

server.listen(PORT, () => {
  console.log(`Tu servidor (reference) listening on port ${PORT} -- user "${USER}", password "${PASSWORD}"`);
  const lan = lanAddresses();
  if (lan.length) console.log("Type one of these in Kino's Configurar > Servidor: " + lan.map((a) => `http://${a}:${PORT}`).join("  "));
});
