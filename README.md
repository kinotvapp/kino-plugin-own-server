# Mi servidor -- a Kino plugin for your own media server

A worked example for the [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin pattern
where the video source isn't a public site but a media server at home -- Jellyfin, Emby, a NAS, or
anything with a login and a JSON API in that shape. Instead of a fixed host in the manifest, the
person types their server's address, user and password the first time they configure the plugin.

This repository is two things: the plugin itself (`plugin.js`, ~90 lines), and a tiny reference
server (`server.mjs`) that speaks the API the plugin expects, so you can install this plugin in Kino
and see it actually stream something without owning a real Jellyfin box.

For the general plugin format -- the manifest, the five functions, the full `kino` API, every limit
-- see the guide in [`kinotvapp/kino-plugin-archive`](https://github.com/kinotvapp/kino-plugin-archive/blob/main/GUIDE.md).
This README only covers what's specific to the "own server" pattern.

## Run the reference server

```
node server.mjs [--port 8096] [--user ana] [--password s3cr3t]
```

No dependencies -- just `node:http` and `node:fs`. Five catalog entries: one that actually streams
(`media/video1.mp4`, a bundled few seconds of test pattern), and four named after the error they
trigger when opened -- "Error: limitado" throws `kino.error("rate_limited")`, and so on, matching
every code the guide documents.

## Install it in Kino

In Kino, Ajustes ▸ Plugins, type this repository's `owner/repo`:

```
kinotvapp/kino-plugin-own-server
```

The consent sheet lists `example.org` as the host -- see "Why the manifest still declares a host"
below. Once installed the plugin shows **Falta configurar**; open **Configurar** and fill in:

- **Servidor**: `http://192.168.1.10:8096` -- your server's LAN address, or wherever you ran
  `server.mjs` (from *another* device on the same network as your phone/TV; see "Why not 127.0.0.1").
- **Usuario** / **Contraseña**: whatever `server.mjs` was started with (`ana` / `s3cr3t` by default).

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

## Develop and test

```
node sdk/validate.mjs .
node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t search prueba
node --test test/plugin.test.mjs
```

The last one runs fully offline against `test/fixtures.json`, a recording of one real exchange with
`server.mjs` (made with `node sdk/run.mjs --record test/fixtures.json ...`) -- no server needs to be
running to run the tests.

## License note

`plugin.js`, `server.mjs` and the bundled test clip are original to this example and free to copy
into your own plugin, same as the rest of the pattern in the guide.
