// Tu servidor -- a Kino plugin for a media server at home (Jellyfin, Emby, a NAS...), and the demo
// plugin of the whole SDK: every apiVersion 3 feature a server of your own can use is here, each
// one exercised by a title of the bundled reference server (README.md, "What each title shows").
//
// The person types the server's address, user and password in Ajustes > Plugins > Configurar; the
// address becomes an allowed host for this install only (the manifest declares no host of its own:
// `"hosts": []`), so `http://` and a LAN address are both fine here -- that would be refused for
// any host a plugin declares in its manifest. A loopback address (127.0.0.1) is refused even
// here: on a phone it would mean the phone itself, never a real server.
//
// Run a real server to try this against: `node server.mjs` (see README.md), then, from your
// computer's own LAN address (not 127.0.0.1 -- see above):
//   node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t search prueba

const base = () => String(kino.config.get("server")).replace(/\/+$/, "");

// Everything cached in kino.storage belongs to one user on one server: storage survives a change
// in Configurar, so a key without them would hand the old server's answers to the new one.
const scope = () => kino.config.get("user") + "@" + base();

// The token does NOT change when only the password changes for the same user@server -- a
// still-valid token keeps working, exactly like a real session would, until the server rejects it.
const tokenKey = () => "token:" + scope();

async function token() {
  await null;
  const saved = kino.storage.get(tokenKey());
  if (saved) return saved;
  const r = await kino.fetch(base() + "/auth", {
    method: "POST",
    body: { json: { user: kino.config.get("user"), password: kino.config.get("password") } },
  });
  if (r.status === 401) throw kino.error("auth_required", "usuario o contraseña incorrectos");
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  const t = r.json().token;
  kino.storage.set(tokenKey(), t);
  return t;
}

// Every request goes through here, so a token invalidated server-side (expired, revoked, or a
// stale one from before a real password change) is forgotten and asked for again on the next call.
async function api(path) {
  const r = await kino.fetch(base() + path, { headers: { "X-Token": await token() } });
  if (r.status === 401) { kino.storage.remove(tokenKey()); throw kino.error("auth_required", "la sesión venció"); }
  if (r.status === 404) throw kino.error("not_found");
  if (r.status === 429) throw kino.error("rate_limited");
  if (r.status === 451) throw kino.error("geo_blocked");
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  return r.json();
}

// Artwork lives on the same typed server, so `http` and a LAN address are fine here too. Posters
// are 2:3 (the cards), backdrops 16:9 (the info page's background, and each episode's still).
const art = (shape, id) => base() + "/img/" + shape + "/" + encodeURIComponent(id) + ".png";
const poster = (id) => art("poster", id);
const backdrop = (id) => art("backdrop", id);

// `kind` comes from the server: "movie", "series" (one season of a show) or "live" (apiVersion 2).
// `ids.tmdb` only when the server knows it: Kino then matches the title with TMDB and fills in its
// info page (cast, director, tagline...).
const item = (x) => ({
  id: x.id,
  ref: x.id,
  title: x.title,
  kind: x.kind,
  year: x.year,
  poster: poster(x.id),
  backdrop: backdrop(x.id),
  ids: x.tmdb ? { tmdb: x.tmdb } : undefined,
});

// Home rows, one per kind; each row's ref is the kind, which browse() pages through.
const ROWS = [
  { id: "novedades", title: "Novedades", kind: "movie" },
  { id: "series", title: "Series", kind: "series" },
  { id: "en-vivo", title: "En vivo", kind: "live" },
];

// Home asks the server three times; the answer is kept for 15 minutes with a storage TTL, so
// opening Kino again right away costs no request. An expired entry reads as null by itself.
const HOME_TTL_MS = 15 * 60 * 1000;

export async function home() {
  const key = "home:" + scope();
  const cached = kino.storage.get(key);
  if (cached) return JSON.parse(cached);
  const rows = [];
  for (const row of ROWS) {
    const p = await api("/items?limit=10&kind=" + row.kind);
    if (p.items.length) rows.push({ id: row.id, title: row.title, ref: row.kind, items: p.items.map(item) });
  }
  kino.storage.set(key, JSON.stringify(rows), { ttlMs: HOME_TTL_MS });
  return rows;
}

export async function browse(ref, cursor) {
  const p = await api("/items?limit=10&kind=" + encodeURIComponent(ref) + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
  return { items: p.items.map(item), next: p.next || undefined };
}

// The server matches ANY word of the query, so "Serie de prueba" also brings "Video de prueba 1".
// kino.rank turns that into a title search: ask with the title's head, drop the stray-word hits,
// best match first -- trying every form of the title Kino knows.
export async function search(query) {
  if (!query.q.trim()) return [];
  const titles = [query.q, query.originalTitle, ...(query.altTitles || [])].filter(Boolean);
  const found = (await api("/items?limit=50&q=" + encodeURIComponent(kino.rank.shortQuery(query.q)))).items;
  const relevant = kino.rank.filterRelevant(found, titles);
  return kino.rank.sortBySimilarity(relevant, titles).map(item);
}

// Each season is its own title on this server, so the answer lists every season of the show in
// `seasons` (the one being answered marked `current`): Kino shows them as chips and calls
// episodes() again with the chosen season's ref.
export async function episodes(ref) {
  const x = await api("/items/" + encodeURIComponent(ref));
  if (x.kind !== "series") throw kino.error("not_found");
  return {
    series: { title: x.show.title, overview: x.show.overview, poster: poster(x.id), backdrop: backdrop(x.id) },
    episodes: x.episodes.map((e) => ({ season: x.season, number: e.number, ref: e.id, title: e.title, still: backdrop(e.id) })),
    seasons: x.seasons.map((s) => ({
      id: s.id,
      ref: s.id,
      title: "Temporada " + s.number,
      number: s.number,
      current: s.id === x.id,
    })),
  };
}

// Movies and episodes are progressive mp4 files, so with `download` declared Kino can save them;
// the live channels are HLS and play as live (never downloadable). A movie with a separate audio
// file gets it as an `audioTracks` entry, merged by the player and picked in its audio menu.
export async function resolve(ref) {
  const x = await api("/items/" + encodeURIComponent(ref));
  if (x.kind === "live") return { url: base() + x.stream, mime: "application/vnd.apple.mpegurl" };
  const hd = kino.config.get("hd");
  const stream = {
    url: base() + x.stream + (hd ? "?quality=hd" : ""),
    mime: "video/mp4",
    // The token is short-lived server-side (see server.mjs); resolve again once it's stale.
    expiresInSeconds: 600,
  };
  if (x.audio && x.audio.length) {
    stream.audioTracks = x.audio.map((a) => ({ lang: a.lang, label: a.label, url: base() + a.stream }));
  }
  return stream;
}

// apiVersion 3's `channels`: Tu servidor's channels in Kino's own En vivo tab (phone tab, TV guide,
// channel drawer), next to -- not instead of -- the "En vivo" Home row above. They show all three
// shapes a plugin can give, mixed in one answer:
//   Noticias -- channels with a `ref`: Kino sends it to resolve() above when the person plays one
//               (per-channel logic, fresh tokens...); the ref is the item id resolve() already knows;
//   Deportes -- channels with an inline `stream`: they play with no call to the plugin at all
//               (the fastest zapping), checked by the same rules as resolve()'s answer;
//   a playlist -- an M3U list and its XMLTV guide that KINO downloads and parses itself (thousands
//               of channels, no JS): its entries become categories named after their groups.
export async function liveCategories() {
  const categories = await api("/channels/categories");
  return [
    ...categories,
    {
      playlist: {
        url: base() + "/lista.m3u",
        format: "m3u",
        // Sent with the list and guide downloads: this server wants its token there too.
        headers: { "X-Token": await token() },
        epg: { url: base() + "/guia.xml.gz", format: "xmltv" },
        refreshHours: 1,
        // Group titles never to show (the "Adultos" group is hidden by Kino whatever you say).
        hideGroups: ["Compras"],
      },
    },
  ];
}

export async function liveChannels({ categoryId }) {
  const page = await api("/channels?category=" + encodeURIComponent(categoryId));
  return {
    items: page.items.map((c) => {
      const channel = { id: c.id, title: c.title, number: c.number, categoryId: c.categoryId, logo: poster(c.id) };
      if (categoryId === "deportes") channel.stream = { url: base() + "/live/" + c.id + ".m3u8", mime: "application/vnd.apple.mpegurl" };
      else channel.ref = c.id;
      return channel;
    }),
  };
}

// Optional: a guide for the channels above (the playlist's comes from its XMLTV file). Kino asks for
// at most 50 ids and a window of at most 24 hours, and keeps what falls inside it.
export async function guide({ channelIds, from, to }) {
  return api("/channels/guide?ids=" + encodeURIComponent(channelIds.join(",")) + "&from=" + from + "&to=" + to);
}
