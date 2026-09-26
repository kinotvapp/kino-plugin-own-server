// Mi servidor -- a Kino plugin for a media server at home (Jellyfin, Emby, a NAS...). The person
// types its address, user and password in Ajustes > Plugins > Configurar; the address becomes an
// allowed host for this install only (see README.md, "Why the manifest still declares a host"), so
// `http://` and a LAN address are both fine here -- that would be refused for any host the plugin
// declares in its own manifest. A loopback address (127.0.0.1) is refused even here: on a phone it
// would mean the phone itself, never a real server, so Kino treats it as almost certainly a mistake.
//
// Run a real server to try this against: `node server.mjs` (see README.md), then, from your
// computer's own LAN address (not 127.0.0.1 -- see above):
//   node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t search prueba

const base = () => String(kino.config.get("server")).replace(/\/+$/, "");

// The token belongs to one user on one server: changing either in Configurar starts a fresh one.
// It does NOT change when only the password changes for the same user@server -- a still-valid
// token keeps working, exactly like a real session would, until the server itself rejects it.
const tokenKey = () => "token:" + kino.config.get("user") + "@" + base();

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

const item = (x) => ({
  id: x.id,
  ref: x.id,
  title: x.title,
  kind: "movie",
  year: x.year,
  poster: base() + "/img/" + encodeURIComponent(x.id),
});

export async function home() {
  const p = await api("/items?limit=10");
  return [{ id: "all", title: "En tu servidor", ref: "all", items: p.items.map(item) }];
}

export async function browse(ref, cursor) {
  const p = await api("/items?limit=10" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
  return { items: p.items.map(item), next: p.next || undefined };
}

export async function search(query) {
  return (await api("/items?q=" + encodeURIComponent(query.q))).items.map(item);
}

export async function resolve(ref) {
  const x = await api("/items/" + encodeURIComponent(ref));
  const hd = kino.config.get("hd");
  return {
    url: base() + x.stream + (hd ? "?quality=hd" : ""),
    mime: "video/mp4",
    // The token is short-lived server-side (see server.mjs); resolve again once it's stale.
    expiresInSeconds: 600,
  };
}
