# Tu servidor -- a Kino plugin for your own media server, and the SDK's demo plugin

A worked example for the [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin pattern
where the video source isn't a public site but a media server at home -- Jellyfin, Emby, a NAS, or
anything with a login and a JSON API in that shape. Instead of a fixed host in the manifest, the
person types their server's address, user and password the first time they configure the plugin.

It is also **the demo plugin of the whole SDK**: every apiVersion 3 feature a server of your own can
use is in `plugin.js`, and each one is exercised by a title of the bundled reference server
(`server.mjs`), so you can install this plugin in Kino and watch every feature work end to end
without owning a real Jellyfin box.

| Feature | Where in `plugin.js` | Title that shows it |
| --- | --- | --- |
| Offline downloads (`download` capability) | the manifest; `resolve` returns a progressive mp4 | any movie or episode: "Descargar" on its info page (phone only) |
| Seasons as separate titles (`seasons` in the `episodes` answer) | `episodes` | "Serie de prueba": chips "Temporada 1" / "Temporada 2" |
| A separate audio file (`audioTracks`) | `resolve` | "Película con doblaje": "Español (doblaje de prueba)" in the audio menu |
| Live items (`kind: "live"`, apiVersion 2) | `item`, `resolve` | the nine channels in the Home "En vivo" row: straight to the player, "EN VIVO" badge |
| Channels with a `ref` (`channels`, apiVersion 3) | `liveChannels`, `resolve` | Noticias 1-3 in the En vivo tab: played through `resolve()` |
| Channels with an inline `stream` | `liveChannels` | Deportes 1-3 in the En vivo tab: played with no call to the plugin |
| A playlist Kino downloads (M3U + XMLTV guide, `hideGroups`) | `liveCategories` | Lista 1-3 under "Lista de prueba"; "Televentas" (hidden by the plugin) and an adults entry (hidden by Kino) never show |
| A User-Agent the channels insist on (`headers` on a Stream, `streamHeaders` on a playlist) | `resolve`, `liveChannels`, `liveCategories` | the "User-Agent de los canales" setting, used by the three shapes above; try it with `--live-agent` |
| A guide for the plugin's own channels | `guide` | Noticias and Deportes: what is on now and next, in the TV guide |
| A cache that expires (`kino.storage.set(key, value, { ttlMs })`) | `home` | the Home rows: kept 15 minutes, then asked again |
| Title search on a loose backend (`kino.rank.*`) | `search` | search "Serie de prueba": the server also answers "Video de prueba 1"; the plugin drops it |
| TMDB matching (`ids.tmdb`) | `item` | "Big Buck Bunny": its info page gains cast, director and tagline from TMDB |
| Typed errors (`kino.error`) | `api` | "Error: no encontrado", "Error: limitado", "Error: región", "Error: no disponible" |
| Artwork on the typed server (`poster`, `backdrop`, `still`) | `item`, `episodes` | every card: its own colour and title; the info page's background; each episode's still |

For the general plugin format -- the manifest, the functions, the full `kino` API, every limit --
see the guide, [`GUIDE.md`](GUIDE.md) (the same file as in every Kino plugin repository). This README
covers what's specific to the "own server" pattern and to each demo. Three powers are deliberately
**not** in this plugin, because a server at home never needs them: Widevine DRM (the `drm`
capability), a declared host reached over plain `http` (`insecureHttp`), and channel streams on any
server (`"liveStreamHosts": "any"`, apiVersion 3: every stream here is on the server the person
typed, so the strict rule is the right one). The guide has a cookbook recipe for each ("A
Widevine-protected stream", "A site of yours without a certificate", and "Live channels: three
recipes", whose first recipe -- a plain M3U list the person types -- is the one that needs
`liveStreamHosts`).

## Run the reference server

```
node server.mjs [--port 8096] [--user ana] [--password s3cr3t] [--live-agent VLC]
```

With `--live-agent VLC` the live channels answer `403` to any player whose User-Agent does not contain `VLC`:
type `VLC/3.0.20 LibVLC/3.0.20` in the plugin's Configurar screen ("User-Agent de los canales") and they play
again. That setting is how a plugin sets the User-Agent some channels insist on: `headers` on a `Stream` (a `ref`
channel's `resolve()` answer, an inline `stream`) and `streamHeaders` on a `playlist` (Kino versions before the one
that added `streamHeaders` ignore that field, so a list plays without it).

No dependencies -- just `node:http`, `node:fs` and `node:zlib`. On start it prints the addresses another device
on your network can type (for example `http://192.168.1.10:8096`). If your computer's firewall asks,
allow incoming connections for `node`.

The catalog, and what each entry is for:

| Title | Kind | What it demonstrates |
| --- | --- | --- |
| Video de prueba 1 | movie | a plain progressive mp4 (`media/video1.mp4`, 3 s of test pattern): plays and downloads |
| Big Buck Bunny | movie | the same clip, with `ids.tmdb` 10378: Kino fills in the info page from TMDB |
| Película con doblaje | movie | a 45 s clip (`media/doblaje.mp4`, test pattern with a frame counter and a steady low tone) plus a separate 45 s audio file (`media/audio-es.m4a`, a fast high beep) as an `audioTracks` entry |
| Serie de prueba | series | season 1 (3 episodes); lists both seasons in `seasons` |
| Serie de prueba (Temporada 2) | series | season 2 (2 episodes), its own title |
| Noticias 1, 2, 3 | live | channels listed by `/channels` and given to Kino with a `ref` (`canal-1` keeps the id the single test channel had in 1.1) |
| Deportes 1, 2, 3 | live | channels listed by `/channels` and given to Kino with an inline `stream` |
| Lista 1, 2, 3 | live | the entries of `/lista.m3u`, with a guide in `/guia.xml.gz` |
| Error: no encontrado / limitado / región / no disponible | movie | `resolve` fails with 404 / 429 / 451 / 503 -> `not_found` / `rate_limited` / `geo_blocked` / `unavailable` |

The API, all under the typed address:

| Route | Token | Answer |
| --- | --- | --- |
| `POST /auth` `{user, password}` | -- | `{token}` or 401 |
| `GET /items?kind=&q=&limit=&cursor=` | `X-Token` | `{items: [{id, kind, title, year, tmdb?}], next?}`; `q` matches ANY word of 3+ letters, on purpose |
| `GET /items/<id>` | `X-Token` | a movie or episode: `{stream, audio: [{lang, label, stream}]}`; a season: `{show, season, episodes, seasons}`; a channel: `{stream}` |
| `GET /stream/v1`, `GET /stream/doblaje`, `GET /stream/audio-es` | -- | the progressive files, with `Range` support |
| `GET /live/canal-<1-9>.m3u8`, `GET /live/canal-<1-9>/<n>.ts` | -- | a channel's live HLS playlist (computed from the clock) and its segments: each channel loops its own three 2-second segments (`media/live/canal-N/`: its own colour and name, a moving bar, a tone of its own pitch) |
| `GET /channels/categories` | `X-Token` | `[{id, title, country}]`: Noticias and Deportes |
| `GET /channels?category=<id>` | `X-Token` | `{items: [{id, title, number, categoryId}]}` |
| `GET /channels/guide?ids=<id,id>&from=<ms>&to=<ms>` | `X-Token` | `[{channelId, title, start, end, description}]`: one programme an hour over the window (at most 24) |
| `GET /lista.m3u` | `X-Token` | an M3U list: Lista 1-3 in group "Lista de prueba", plus "Televentas" in "Compras" and one entry in "Adultos" |
| `GET /guia.xml.gz` | `X-Token` | its XMLTV guide, gzipped: six hourly programmes per Lista channel, starting an hour ago |
| `GET /img/poster/<id>.png`, `GET /img/backdrop/<id>.png` | -- | a title's poster (300x450) or backdrop (480x270; an episode's id gives its still), drawn on request by `artwork.mjs`; `GET /img/<id>` is the poster too |

Media routes need no token because the player fetches them without one; a real server would put a
short-lived token in the URL or return `headers` with the `Stream`. Images are loaded by Kino
without your headers either, so artwork has to be reachable as a plain URL.

The artwork is drawn by `artwork.mjs` in plain Node (a 5x7 bitmap font and a hand-written PNG
encoder, no packages): a colour picked from the title's id, the title in big letters (uppercase, no
accents), a label on top ("PELICULA", "SERIE - TEMPORADA 2", "T1 - EPISODIO 3", "EN VIVO") and "TU
SERVIDOR" at the bottom. Nothing is committed: each image is drawn on first request, about 2 KB.

## Install it in Kino

In Kino, **Ajustes ▸ Plugins ▸ Agregar**, type this repository's `owner/repo`:

```
kinotvapp/kino-plugin-own-server
```

It needs a Kino build that knows apiVersion 3; an older one refuses it with "Este plugin necesita
una versión más nueva de Kino". The consent sheet lists no host (see "Why the manifest declares no
host" below), then "Este plugin usa tu usuario y contraseña", "Se conectará a los servidores que
escribas en su configuración" (the `url` setting), "Puede descargar videos para verlos sin conexión"
(the `download` capability) and "Agrega canales en vivo a la pestaña En vivo" (the `channels`
capability). Updating from 1.1 asks for approval again, because the update adds `channels`. Once
installed the plugin shows **Falta configurar**; open **Configurar** and fill in:

- **Servidor**: `http://192.168.1.10:8096` -- your server's LAN address, or one of the addresses
  `server.mjs` printed (from *another* device on the same network as your phone/TV; see "Why not
  127.0.0.1").
- **Usuario** / **Contraseña**: whatever `server.mjs` was started with (`ana` / `s3cr3t` by default).

Then, on the phone:

1. **Inicio** shows three rows from "Tu servidor": Novedades, Series, En vivo (the nine channels) --
   each card with its own colour and title.
2. **Película con doblaje**: play it (45 s, time enough), open the audio menu, pick "Español (doblaje
   de prueba)" -- the steady low tone gives way to a fast high beep.
3. **Serie de prueba**: the info page shows the chips "Temporada 1" and "Temporada 2"; choosing
   "Temporada 2" loads its two episodes as its own title.
4. **Noticias 1** from the En vivo row: opens straight into the player with the live overlay (no
   seek bar) and keeps playing its looping card with a moving bar.
5. **Video de prueba 1** (or any movie or episode): "Descargar" on the info page; it appears in
   Descargas and plays with the server stopped. A channel is never offered for download.
6. **Big Buck Bunny**: the info page carries TMDB's cast, director and tagline.
7. Search **Serie de prueba**: only the two seasons come back from this plugin.
8. **En vivo** (the phone tab; on TV the guide and the channel drawer): a "Tu servidor" section with
   the categories Noticias, Deportes and Lista de prueba, three channels each, each with its logo
   and number. Noticias 1-3 play through `resolve()`, Deportes 1-3 straight from their inline
   stream, Lista 1-3 from the list Kino downloaded. Each shows its own colour, name and tone, so
   zapping up and down is easy to follow (it stays within Tu servidor's channels). The guide shows
   "Noticiero", "Magazín"... on Noticias, "Fútbol en vivo", "Análisis"... on Deportes and "Programa
   1-6" on the Lista channels. "Televentas" (group "Compras", hidden by the plugin) and the entry in
   "Adultos" (hidden by Kino) never appear.

## Why the manifest declares no host

This plugin only ever talks to the server the person types, so `kino-plugin.json` declares
`"hosts": []`. That is allowed from `"apiVersion": 2` for a plugin with at least one `url` setting
(without one, `node sdk/validate.mjs .` refuses it the way Kino does: "El campo \"hosts\" solo
puede estar vacío si el plugin tiene un ajuste de tipo \"url\""). The typed server becomes an
allowed host for this install once the person saves Configurar, and the consent sheet announces it
with its own line, "Se conectará a los servidores que escribas en su configuración".

Up to 1.1.1 the manifest declared the placeholder `"tu-servidor.invalid"` (a reserved name that never
resolves) so that Kino builds from before that rule would still install it. 1.2 is apiVersion 3,
which those builds refuse anyway, so the placeholder is gone. If your own plugin also fetches
something from the internet (a metadata API, your project's site), declare that host.

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
  which returns the playlist; when the stream cuts, Kino calls `resolve` again by itself. The En vivo
  tab is a separate capability, `channels` (next section); this plugin does both.
- **Artwork.** `poster`, `backdrop` and `still` must normally be `https`; on the server the person
  typed, `http` and a LAN address work too, the same as its streams. The kit in `sdk/` does not yet
  carry an episode's `still` through (`node sdk/run.mjs ... episodes` leaves it out); Kino does.
- **`kino.rank`.** `search` asks the server with `kino.rank.shortQuery(q)`, then keeps what
  `filterRelevant` accepts against every form of the title Kino knows (`q`, `originalTitle`,
  `altTitles`) and orders it with `sortBySimilarity`.

## Channels (apiVersion 3)

With `"apiVersion": 3` and `"channels"` in `capabilities`, Kino calls three more exports and shows
what they give in its own En vivo tab, TV guide, channel drawer and Home "Canales en vivo" row, in a
section named after the plugin. On install the person reads and approves "Agrega canales en vivo a
la pestaña En vivo"; an update that adds `channels` (1.1 to 1.2 here) asks for that approval again.
`plugin.js` gives all three shapes a plugin can use, mixed in one answer:

```js
export async function liveCategories() {
  const categories = await api("/channels/categories");          // [{ id, title, country }]
  return [
    ...categories,
    { playlist: {                                                 // shape 3: Kino downloads and parses it
      url: base() + "/lista.m3u", format: "m3u",
      headers: { "X-Token": await token() },                      // sent with the list and guide downloads
      epg: { url: base() + "/guia.xml.gz", format: "xmltv" },
      refreshHours: 1,
      hideGroups: ["Compras"],                                    // "Adultos" is hidden by Kino anyway
    } },
  ];
}

export async function liveChannels({ categoryId }) {
  const page = await api("/channels?category=" + encodeURIComponent(categoryId));
  return {
    items: page.items.map((c) => {
      const channel = { id: c.id, title: c.title, number: c.number, categoryId: c.categoryId, logo: poster(c.id) };
      if (categoryId === "deportes") channel.stream = { url: base() + "/live/" + c.id + ".m3u8", mime: "application/vnd.apple.mpegurl" }; // shape 2
      else channel.ref = c.id;                                                                                                                // shape 1
      return channel;
    }),
  };
}

export async function guide({ channelIds, from, to }) {          // optional
  return api("/channels/guide?ids=" + encodeURIComponent(channelIds.join(",")) + "&from=" + from + "&to=" + to);
}
```

1. **A `ref`** (Noticias): the ref goes to `resolve()` when the person plays the channel, exactly
   like a `live` item's. Use it when playing needs the plugin: a fresh token, a per-channel lookup.
2. **An inline `stream`** (Deportes): checked by the same rules as `resolve()`'s answer and played
   with no call to the plugin at all -- the fastest zapping.
3. **A playlist** (Lista de prueba): Kino downloads the M3U list and its XMLTV guide itself, with the
   `headers` given, and groups the entries into categories by `group-title`. `hideGroups` hides
   groups by title (case doesn't matter); groups such as "Adultos" are always hidden. For lists of
   thousands of channels with no plugin code per channel.

The list, its guide and every stream are on the server the person typed, so the strict host rule
covers them: no `liveStreamHosts` here. A list whose streams live on servers nobody can declare
ahead of time is what `"liveStreamHosts": "any"` is for -- see the guide's recipe "Live channels:
three recipes" (a plain M3U list the person types). The limits (categories, channels per page, the
guide window, playlist sizes) are in the guide, "Channels in the En vivo tab" and "Live channels".

Try each shape against the reference server (`--config` as in "Develop and test" below):

```
node sdk/run.mjs . live categories          # the two categories, then the playlist as Kino reads it:
                                            #   3 canales en 1 categorías; 0 entradas descartadas; 2 ocultas (adultos)
node sdk/run.mjs . live channels noticias   # three channels with a ref; then plays the first through resolve()
node sdk/run.mjs . live channels deportes   # three channels with an inline stream
node sdk/run.mjs . live guide canal-1,canal-4
node sdk/validate.mjs . --run liveCategories   # also downloads and parses the playlist; exit 0 = accepted
```

## Develop and test

```
node sdk/validate.mjs .
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t home
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t episodes serie-t1
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t resolve doblaje
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t live categories
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t live channels noticias
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t live channels deportes
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t live guide canal-1,canal-4
node --test test/*.test.mjs
node --test sdk/test/kit.test.mjs
```

The last one runs fully offline against `test/fixtures.json`, recordings of real exchanges with
`server.mjs` (made with `node sdk/run.mjs --record <file> ...`, the address then rewritten to
`192.168.1.10`) -- no server needs to be running to run the tests. They check search (with and
without `kino.rank` dropping near-misses), the three Home rows, the artwork URLs, the seasons, the
audio track, the live playlist and the three channel shapes (the M3U list is in the recording too,
served to the kit's playlist download only with the recorded token; the guide was recorded with the
clock pinned, which the test pins the same way), plus `artwork.mjs` itself (sizes, same bytes every
time, a different image per title). The last line runs the kit's own tests.

The channels' segments in `media/live/canal-N/` are committed; `node media/make-live.mjs` (needs
ffmpeg) draws them again from `artwork.mjs` if you change the channel list.

To try the server while another copy is already running, start it on another port:
`node server.mjs --port 8123`.

`sdk/`, `contract.json`, `kino.d.ts` and `GUIDE.md` are a copy of Kino's plugin kit (apiVersion 3);
`sdk/kino-rank.mjs` is the same ranking code the app runs, and `sdk/live-playlist.mjs` the same M3U
and XMLTV rules.

## License

The code in this repository is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 kinotvapp.

## License note

`plugin.js`, `server.mjs`, `artwork.mjs` and the bundled test media (`media/`, generated with ffmpeg's test
sources) are original to this example and free to copy into your own plugin, same as the rest of the
pattern in the guide.
