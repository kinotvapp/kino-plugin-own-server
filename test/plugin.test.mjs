// Offline tests: every answer comes from test/fixtures.json, a recording of real exchanges with
// server.mjs (README.md, "Develop and test"), so no server needs to be running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";
import { loadPlaylist } from "../sdk/live-playlist.mjs";
import { validateManifest } from "../sdk/contract.mjs";
import { artwork } from "../artwork.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures.json");
const skip = !existsSync(fixtures) && "record test/fixtures.json first";

// The same server/user/password used when the fixtures were recorded: they decide the URLs and
// cache keys the plugin builds, which the replay looks up by exact match.
const config = { server: "http://192.168.1.10:8096", user: "ana", password: "s3cr3t" };
const server = config.server;

// The playlist is downloaded by Kino itself, not through kino.fetch: the tests' own fetch answers
// it from the same recording, and only with the token the plugin put in its headers.
const tape = skip ? [] : JSON.parse(readFileSync(fixtures, "utf8"));
async function fetchImpl(url, init = {}) {
  const taped = tape.find((t) => t.key === JSON.stringify(["GET", String(url), null]));
  const token = JSON.parse(Buffer.from(tape[0].body, "base64")).token;
  if (!taped) return new Response("not recorded", { status: 404 });
  if (init.headers["X-Token"] !== token) return new Response("no token", { status: 401 });
  return new Response(Buffer.from(taped.body, "base64"), { status: taped.status });
}

// `live guide` asks for a window starting two hours before now; the guide was recorded with the
// clock at this instant, so the replayed request matches it.
const RECORDED_AT = 1790575200000;

async function run(fn, ...args) {
  const now = Date.now;
  Date.now = () => RECORDED_AT;
  let r;
  try {
    r = await validate(root, { run: fn, args, config, replay: fixtures, fetchImpl });
  } finally {
    Date.now = now;
  }
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  return r.output;
}

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("a one-word search keeps every hit that has the word", { skip }, async () => {
  const out = await run("search", "prueba");
  assert.deepEqual(out.items.map((x) => x.id), ["v1", "serie-t1", "serie-t2"]);
});

test("a full title drops what only shares a stray word with it", { skip }, async () => {
  // The server answers "Serie de prueba" with four hits (any shared word); two are near-misses.
  const out = await run("search", "Serie de prueba");
  assert.deepEqual(out.items.map((x) => x.id), ["serie-t1", "serie-t2"]);
});

test("home: movies (one with a TMDB id), series and the live channels", { skip }, async () => {
  const rows = await run("home");
  assert.deepEqual(rows.map((r) => r.id), ["novedades", "series", "en-vivo"]);
  const movies = rows[0].items;
  assert.equal(movies.find((x) => x.id === "bbb").tmdb, 10378);
  assert.deepEqual(rows[1].items.map((x) => x.kind), ["series", "series"]);
  assert.deepEqual(rows[2].items.map((x) => [x.id, x.kind]), [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`canal-${n}`, "live"]));
});

test("every card points at its own poster and backdrop on the typed server", { skip }, async () => {
  const rows = await run("home");
  const bbb = rows[0].items.find((x) => x.id === "bbb");
  assert.equal(bbb.poster, server + "/img/poster/bbb.png");
  assert.equal(bbb.backdrop, server + "/img/backdrop/bbb.png");
});

// The PNG's width and height, straight from its IHDR chunk.
const size = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test("artwork: a 2:3 poster and a 16:9 backdrop, the same bytes every time, different per title", () => {
  const a = artwork({ id: "doblaje", title: "Película con doblaje", label: "Pelicula", shape: "poster" });
  assert.deepEqual([...a.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.deepEqual(size(a), [300, 450]);
  const b = artwork({ id: "serie-t1-e3", title: "El final de temporada", label: "T1 - Episodio 3", shape: "backdrop" });
  assert.deepEqual(size(b), [480, 270]);
  assert.ok(a.equals(artwork({ id: "doblaje", title: "Película con doblaje", label: "Pelicula", shape: "poster" })));
  assert.ok(!a.equals(artwork({ id: "bbb", title: "Big Buck Bunny", label: "Pelicula", shape: "poster" })));
});

test("episodes lists the season's episodes and every season of the show", { skip }, async () => {
  const out = await run("episodes", "serie-t1");
  assert.deepEqual(out.episodes.map((e) => [e.season, e.number, e.ref]), [[1, 1, "serie-t1-e1"], [1, 2, "serie-t1-e2"], [1, 3, "serie-t1-e3"]]);
  assert.deepEqual(out.seasons.map((s) => [s.id, s.number, s.current]), [["serie-t1", 1, true], ["serie-t2", 2, false]]);
});

test("a movie with a separate audio file resolves with audioTracks", { skip }, async () => {
  const s = await run("resolve", "doblaje");
  assert.equal(s.url, server + "/stream/doblaje");
  assert.equal(s.mime, "video/mp4");
  assert.deepEqual(s.audioTracks, [{ lang: "es-419", label: "Español (doblaje de prueba)", url: server + "/stream/audio-es" }]);
});

test("a live channel resolves to an HLS playlist", { skip }, async () => {
  const s = await run("resolve", "canal-1");
  assert.equal(s.url, server + "/live/canal-1.m3u8");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
});

test("the manifest is apiVersion 3 with channels, and declares no host of its own", async () => {
  const m = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  assert.equal(m.ok, true);
  assert.equal(m.manifest.apiVersion, 3);
  assert.ok(m.manifest.capabilities.includes("channels"));
  assert.deepEqual(m.manifest.hosts, []);
  assert.equal(m.manifest.liveStreamHostsAny, false);
  const r = await validate(root);
  assert.ok(r.consent.some((c) => c.text === "Agrega canales en vivo a la pestaña En vivo" && !c.danger));
});

test("channels: all three shapes -- ref channels, inline-stream channels and a playlist with a guide", { skip }, async () => {
  const cats = await run("liveCategories");
  assert.deepEqual(cats.categories.map((c) => c.id), ["noticias", "deportes"]);
  assert.deepEqual(cats.playlists.map((p) => [p.url, p.epgUrl, p.hideGroups]), [[server + "/lista.m3u", server + "/guia.xml.gz", ["compras"]]]);
  const news = await run("liveChannels", "noticias");
  assert.deepEqual(news.items.map((c) => [c.id, c.number, c.ref !== "", c.stream === null]), [["canal-1", 1, true, true], ["canal-2", 2, true, true], ["canal-3", 3, true, true]]);
  const sports = await run("liveChannels", "deportes");
  assert.deepEqual(sports.items.map((c) => [c.ref, c.stream && c.stream.url]), [4, 5, 6].map((n) => ["", server + `/live/canal-${n}.m3u8`]));
  const stream = await run("resolve", news.items[0].ref);
  assert.equal(stream.mime, "application/vnd.apple.mpegurl");
  assert.ok(stream.url.startsWith(server + "/live/canal-1.m3u8"));
});

test("channels: the playlist shows its three channels, the Compras and Adultos groups hidden", { skip }, async () => {
  const cats = await run("liveCategories");
  const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;
  const s = await loadPlaylist(cats.playlists[0], { manifest, servers: [server], fetchImpl });
  assert.equal(s.channels, 3);
  assert.equal(s.hidden, 2);
  assert.equal(s.skipped, 0);
  assert.deepEqual(s.categories.map((c) => [c.title, c.count]), [["Lista de prueba", 3]]);
  assert.deepEqual(s.entries.map((e) => [e.tvgId, e.url]), [7, 8, 9].map((n) => [`lista-${n}`, server + `/live/canal-${n}.m3u8`]));
});

test("channels: a small guide for the ref and inline-stream channels", { skip }, async () => {
  const g = await run("guide", "canal-1,canal-4");
  assert.deepEqual([...new Set(g.map((e) => e.channelId))].sort(), ["canal-1", "canal-4"]);
  assert.ok(g.every((e) => e.end > e.start));
  assert.deepEqual([...new Set(g.filter((e) => e.channelId === "canal-4").map((e) => e.title))].sort(), ["Análisis", "Fútbol en vivo", "Goles de la fecha"]);
});
