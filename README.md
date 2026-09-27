# Tu servidor -- a Kino plugin for your own media server, and the SDK's demo plugin

A worked example for the [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin pattern
where the video source isn't a public site but a media server at home -- Jellyfin, Emby, a NAS, or
anything with a login and a JSON API in that shape. Instead of a fixed host in the manifest, the
person types their server's address, user and password the first time they configure the plugin.

It is also **the demo plugin of the whole SDK**: every apiVersion 2 feature a server of your own can
use is in `plugin.js`, and each one is exercised by a title of the bundled reference server
(`server.mjs`), so you can install this plugin in Kino and watch every feature work end to end
without owning a real Jellyfin box.

| Feature | Where in `plugin.js` | Title that shows it |
| --- | --- | --- |
| Offline downloads (`download` capability) | the manifest; `resolve` returns a progressive mp4 | any movie or episode: "Descargar" on its info page (phone only) |
| Seasons as separate titles (`seasons` in the `episodes` answer) | `episodes` | "Serie de prueba": chips "Temporada 1" / "Temporada 2" |
| A separate audio file (`audioTracks`) | `resolve` | "Película con doblaje": "Español (doblaje de prueba)" in the audio menu |
| Live channels (`kind: "live"`) | `item`, `resolve` | "Canal de prueba" in the "En vivo" row: straight to the player, "EN VIVO" badge |
| A cache that expires (`kino.storage.set(key, value, { ttlMs })`) | `home` | the Home rows: kept 15 minutes, then asked again |
| Title search on a loose backend (`kino.rank.*`) | `search` | search "Serie de prueba": the server also answers "Video de prueba 1" and "Canal de prueba"; the plugin drops them |
| TMDB matching (`ids.tmdb`) | `item` | "Big Buck Bunny": its info page gains cast, director and tagline from TMDB |
| Typed errors (`kino.error`) | `api` | "Error: no encontrado", "Error: limitado", "Error: región", "Error: no disponible" |

For the general plugin format -- the manifest, the five functions, the full `kino` API, every limit
-- see the guide in [`kinotvapp/kino-plugin-archive`](https://github.com/kinotvapp/kino-plugin-archive/blob/main/GUIDE.md).
This README covers what's specific to the "own server" pattern and to each demo. Two apiVersion 2
powers are deliberately **not** in this plugin, because a server at home never needs them: Widevine
DRM (the `drm` capability) and a declared host reached over plain `http` (`insecureHttp`). The guide
has a cookbook recipe for each ("A Widevine-protected stream", "A site of yours without a
certificate").

## Run the reference server

```
node server.mjs [--port 8096] [--user ana] [--password s3cr3t]
```

No dependencies -- just `node:http` and `node:fs`. On start it prints the addresses another device
on your network can type (for example `http://192.168.1.10:8096`). If your computer's firewall asks,
allow incoming connections for `node`.

The catalog, and what each entry is for:

| Title | Kind | What it demonstrates |
| --- | --- | --- |
| Video de prueba 1 | movie | a plain progressive mp4 (`media/video1.mp4`, 3 s of test pattern): plays and downloads |
| Big Buck Bunny | movie | the same clip, with `ids.tmdb` 10378: Kino fills in the info page from TMDB |
| Película con doblaje | movie | the clip plus a separate audio file (`media/audio-es.m4a`, a beeping tone) as an `audioTracks` entry |
| Serie de prueba | series | season 1 (3 episodes); lists both seasons in `seasons` |
| Serie de prueba (Temporada 2) | series | season 2 (2 episodes), its own title |
| Canal de prueba | live | an endless HLS playlist looping six 2-second segments (`media/live/`) |
| Error: no encontrado / limitado / región / no disponible | movie | `resolve` fails with 404 / 429 / 451 / 503 -> `not_found` / `rate_limited` / `geo_blocked` / `unavailable` |

The API, all under the typed address:

| Route | Token | Answer |
| --- | --- | --- |
| `POST /auth` `{user, password}` | -- | `{token}` or 401 |
| `GET /items?kind=&q=&limit=&cursor=` | `X-Token` | `{items: [{id, kind, title, year, tmdb?}], next?}`; `q` matches ANY word of 3+ letters, on purpose |
| `GET /items/<id>` | `X-Token` | a movie or episode: `{stream, audio: [{lang, label, stream}]}`; a season: `{show, season, episodes, seasons}`; a channel: `{stream}` |
| `GET /stream/v1`, `GET /stream/audio-es` | -- | the progressive files, with `Range` support |
| `GET /live/canal-1.m3u8`, `GET /live/canal-1/<n>.ts` | -- | the live playlist (computed from the clock) and its segments |
| `GET /img/<id>` | -- | a 1x1 placeholder poster |

Media routes need no token because the player fetches them without one; a real server would put a
short-lived token in the URL or return `headers` with the `Stream`.

## Install it in Kino

In Kino, **Ajustes ▸ Plugins ▸ Agregar**, type this repository's `owner/repo`:

```
kinotvapp/kino-plugin-own-server
```

The consent sheet lists `example.org` as the host (see "Why the manifest still declares a host"
below) and "Puede descargar videos para verlos sin conexión" (the `download` capability). Once
installed the plugin shows **Falta configurar**; open **Configurar** and fill in:

- **Servidor**: `http://192.168.1.10:8096` -- your server's LAN address, or one of the addresses
  `server.mjs` printed (from *another* device on the same network as your phone/TV; see "Why not
  127.0.0.1").
- **Usuario** / **Contraseña**: whatever `server.mjs` was started with (`ana` / `s3cr3t` by default).

Then, on the phone:

1. **Inicio** shows three rows from "Tu servidor": Novedades, Series, En vivo.
2. **Película con doblaje**: play it, open the audio menu, pick "Español (doblaje de prueba)" -- you
   hear the beeping tone instead of the clip's own audio.
3. **Serie de prueba**: the info page shows the chips "Temporada 1" and "Temporada 2"; choosing
   "Temporada 2" loads its two episodes as its own title.
4. **Canal de prueba**: opens straight into the player with the live overlay (no seek bar) and keeps
   playing the looping test pattern.
5. **Video de prueba 1** (or any movie or episode): "Descargar" on the info page; it appears in
   Descargas and plays with the server stopped. "Canal de prueba" is never offered for download.
6. **Big Buck Bunny**: the info page carries TMDB's cast, director and tagline.
7. Search **Serie de prueba**: only the two seasons come back from this plugin.

## Why the manifest still declares a host

`kino-plugin.json`'s `hosts` still needs one real-looking entry even though the plugin never talks
to it -- Kino's manifest schema requires at least one declared host, and the person-typed server is
a *different* mechanism (a "user-host"), added only once they save Configurar, never something the
manifest itself can set. Use your own project's domain for a plugin you publish for real.

## Why not 127.0.0.1

A loopback address is refused, both by the app's Configurar screen and by this repository's own
`sdk/` kit -- on a phone or TV, `127.0.0.1` means that device itself, never a real server elsewhere
on the network, so Kino treats it as almost certainly a mistake. Point at your machine's actual LAN
address instead (`ipconfig getifaddr en0` on a Mac, `hostname -I` on Linux).

## About the bundled token

`plugin.js` caches its login token in `kino.storage`, keyed by `user@server` -- not by password. If
you only change the password in Configurar without changing the user or server, the plugin still has
a token from the earlier, correct login and keeps working until the server itself rejects it (this
reference server never does -- it keeps every token it ever issued). A real server that expires or
revokes tokens will trigger a fresh login on its own; the design is meant to avoid re-authenticating
on every single call, not to force a password to change be noticed immediately.

The Home cache is keyed by `user@server` for the same reason: `kino.storage` survives a change in
Configurar, and a key without them would show the old server's rows. It is written with
`{ ttlMs: 15 * 60 * 1000 }`, so after 15 minutes `kino.storage.get` returns `null` by itself and the
rows are asked for again -- no timestamp bookkeeping in the plugin.

## Notes on each feature

- **Downloads.** Kino calls `resolve` when a download runs and saves the `Stream` as one file, so
  only progressive files download; the HLS channel is refused ("Este video no se puede descargar").
  `audioTracks` are not saved: an offline "Película con doblaje" has only the clip's own audio.
- **Seasons.** This server keeps each season as its own title, so `episodes(ref)` returns only that
  season's episodes and lists every season in `seasons`, with `current: true` on the one answered. A
  source that keeps a whole show in one list would instead give each episode its `season` and leave
  `seasons` out.
- **Live.** A `live` item needs `"apiVersion": 2` (on 1 it is dropped). Its `ref` goes to `resolve`,
  which returns the playlist; when the stream cuts, Kino calls `resolve` again by itself.
- **`kino.rank`.** `search` asks the server with `kino.rank.shortQuery(q)`, then keeps what
  `filterRelevant` accepts against every form of the title Kino knows (`q`, `originalTitle`,
  `altTitles`) and orders it with `sortBySimilarity`.

## Develop and test

```
node sdk/validate.mjs .
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t home
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t episodes serie-t1
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t resolve doblaje
node --test test/plugin.test.mjs
```

The last one runs fully offline against `test/fixtures.json`, recordings of real exchanges with
`server.mjs` (made with `node sdk/run.mjs --record <file> ...`, the address then rewritten to
`192.168.1.10`) -- no server needs to be running to run the tests. They check search (with and
without `kino.rank` dropping near-misses), the three Home rows, the seasons, the audio track and the
live playlist.

`sdk/` and `contract.json` are a copy of Kino's plugin kit (apiVersion 2); `sdk/kino-rank.mjs` is the
same ranking code the app runs.

## License note

`plugin.js`, `server.mjs` and the bundled test media (`media/`, generated with ffmpeg's test
sources) are original to this example and free to copy into your own plugin, same as the rest of the
pattern in the guide.
