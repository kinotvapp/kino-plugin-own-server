// Offline tests: every answer comes from test/fixtures.json, a recording of real exchanges with
// server.mjs (README.md, "Develop and test"), so no server needs to be running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures.json");
const skip = !existsSync(fixtures) && "record test/fixtures.json first";

// The same server/user/password used when the fixtures were recorded: they decide the URLs and
// cache keys the plugin builds, which the replay looks up by exact match.
const config = { server: "http://192.168.1.10:8096", user: "ana", password: "s3cr3t" };
const server = config.server;

async function run(fn, ...args) {
  const r = await validate(root, { run: fn, args, config, replay: fixtures });
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
  assert.deepEqual(out.items.map((x) => x.id), ["v1", "serie-t1", "serie-t2", "canal-1"]);
});

test("a full title drops what only shares a stray word with it", { skip }, async () => {
  // The server answers "Serie de prueba" with four hits (any shared word); two are near-misses.
  const out = await run("search", "Serie de prueba");
  assert.deepEqual(out.items.map((x) => x.id), ["serie-t1", "serie-t2"]);
});

test("home: movies (one with a TMDB id), series and a live channel", { skip }, async () => {
  const rows = await run("home");
  assert.deepEqual(rows.map((r) => r.id), ["novedades", "series", "en-vivo"]);
  const movies = rows[0].items;
  assert.equal(movies.find((x) => x.id === "bbb").tmdb, 10378);
  assert.deepEqual(rows[1].items.map((x) => x.kind), ["series", "series"]);
  assert.deepEqual(rows[2].items.map((x) => [x.id, x.kind]), [["canal-1", "live"]]);
});

test("episodes lists the season's episodes and every season of the show", { skip }, async () => {
  const out = await run("episodes", "serie-t1");
  assert.deepEqual(out.episodes.map((e) => [e.season, e.number, e.ref]), [[1, 1, "serie-t1-e1"], [1, 2, "serie-t1-e2"], [1, 3, "serie-t1-e3"]]);
  assert.deepEqual(out.seasons.map((s) => [s.id, s.number, s.current]), [["serie-t1", 1, true], ["serie-t2", 2, false]]);
});

test("a movie with a separate audio file resolves with audioTracks", { skip }, async () => {
  const s = await run("resolve", "doblaje");
  assert.equal(s.url, server + "/stream/v1");
  assert.equal(s.mime, "video/mp4");
  assert.deepEqual(s.audioTracks, [{ lang: "es-419", label: "Español (doblaje de prueba)", url: server + "/stream/audio-es" }]);
});

test("the live channel resolves to an HLS playlist", { skip }, async () => {
  const s = await run("resolve", "canal-1");
  assert.equal(s.url, server + "/live/canal-1.m3u8");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
});
