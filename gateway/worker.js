/* Avatar gateway: one stable address in front of changing GPU servers.
 *
 * Runs as a Cloudflare Worker (free plan) or on any machine with Node 18+ (see dev-server.mjs).
 * Only the small "signaling" calls pass through here (offer, humanaudio, ...). The video itself still flows
 * straight between the GPU server and the browser, so this gateway needs no GPU and almost no traffic.
 *
 * Browser / app side (same paths as LiveTalking, so the app's "Server address" box just takes this gateway's URL):
 *   POST /offer | /human | /humanaudio | /interrupt_talk | /is_speaking | /set_audiotype
 *        /offer picks the best server that is up and replies with {..., backend: "<id>"};
 *        later calls send header  X-LT-Backend: <id>  to reach the same server.
 *   GET  /health        which registered servers are up (names only, never their addresses)
 * GPU host side (protected by REGISTER_SECRET):
 *   POST /register      {id, url, priority?, ttl?}   "I am up at this https address", renew every few minutes
 *   POST /unregister    {id}                          "I am going away"
 *
 * Settings: KV namespace BACKENDS, secret REGISTER_SECRET, optional ALLOWED_ORIGIN (e.g. your Pages site),
 *           PROBE_PATH (default /index.html), ALLOW_HTTP=1 (tests only).
 */
const ROUTES = new Set(["offer", "human", "humanaudio", "interrupt_talk", "is_speaking", "set_audiotype"]);

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-LT-Backend, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const reply = (env, obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(env) } });

function same(a, b) {                                   // constant-time string compare
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const authed = (req, env) => !!env.REGISTER_SECRET && same((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.REGISTER_SECRET);

async function all(env) {
  const list = await env.BACKENDS.list({ prefix: "b:" });
  const out = [];
  for (const k of list.keys) {
    const v = await env.BACKENDS.get(k.name);
    if (v) { try { out.push(JSON.parse(v)); } catch { /* skip bad row */ } }
  }
  return out.sort((a, b) => a.priority - b.priority || b.seen - a.seen);
}

async function isUp(env, url) {
  try {
    const r = await fetch(url.replace(/\/+$/, "") + (env.PROBE_PATH || "/index.html"), { signal: AbortSignal.timeout(2500), redirect: "manual" });
    return r.status < 400;                              // a dead tunnel answers 404/502/530, a live server answers 200
  } catch { return false; }
}

async function forward(req, url, route, body) {
  const r = await fetch(url.replace(/\/+$/, "") + "/" + route, {
    method: "POST", body, headers: { "Content-Type": req.headers.get("Content-Type") || "application/json" }, signal: AbortSignal.timeout(60000),
  });
  return r;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const path = u.pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });

    if (req.method === "GET" && (path === "/health" || path === "")) {
      const rows = await all(env);
      const up = await Promise.all(rows.map((b) => isUp(env, b.url)));
      return reply(env, { gateway: true, servers: rows.map((b, i) => ({ id: b.id, priority: b.priority, up: up[i], seconds_since_seen: Math.round((Date.now() - b.seen) / 1000) })) });
    }

    if (req.method !== "POST") return reply(env, { error: "Not found" }, 404);

    /* ---- GPU hosts announce themselves ---- */
    if (path === "/register" || path === "/unregister") {
      if (!authed(req, env)) return reply(env, { error: "Unauthorized" }, 401);
      let b; try { b = await req.json(); } catch { return reply(env, { error: "Bad JSON" }, 400); }
      const id = String(b.id || "");
      if (!/^[a-z0-9_-]{1,32}$/.test(id)) return reply(env, { error: "id must be 1-32 letters, digits, - or _" }, 400);
      if (path === "/unregister") { await env.BACKENDS.delete("b:" + id); return reply(env, { ok: true }); }
      let url; try { url = new URL(String(b.url)); } catch { return reply(env, { error: "url is not valid" }, 400); }
      if (url.protocol !== "https:" && !(env.ALLOW_HTTP === "1" && url.protocol === "http:")) return reply(env, { error: "url must be https" }, 400);
      const priority = Math.max(0, Math.min(99, parseInt(b.priority ?? 10, 10) || 0));
      const ttl = Math.max(60, Math.min(86400, parseInt(b.ttl ?? 900, 10) || 900));
      await env.BACKENDS.put("b:" + id, JSON.stringify({ id, url: url.origin + url.pathname.replace(/\/+$/, ""), priority, seen: Date.now() }), { expirationTtl: ttl });
      return reply(env, { ok: true, id, priority, ttl });
    }

    /* ---- the app's calls ---- */
    const route = path.split("/").pop();
    if (!ROUTES.has(route)) return reply(env, { error: "Not found" }, 404);
    const body = await req.arrayBuffer();

    if (route === "offer") {                             // new call: best server that is up, else the next
      const rows = await all(env);
      if (!rows.length) return reply(env, { error: "No live avatar server has registered yet." }, 503);
      for (const b of rows) {
        if (!(await isUp(env, b.url))) continue;
        try {
          const r = await forward(req, b.url, "offer", body);
          if (r.status >= 500) continue;
          const text = await r.text();
          let out = text;
          if (r.status === 200) { try { const j = JSON.parse(text); j.backend = b.id; out = JSON.stringify(j); } catch { /* leave as is */ } }
          return new Response(out, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store", ...cors(env) } });
        } catch { /* try the next one */ }
      }
      return reply(env, { error: "No live avatar server is reachable right now." }, 503);
    }

    const id = req.headers.get("X-LT-Backend") || "";
    const raw = id ? await env.BACKENDS.get("b:" + id) : null;
    if (!raw) return reply(env, { error: "That live avatar server is no longer registered." }, 409);
    try {
      const r = await forward(req, JSON.parse(raw).url, route, body);
      return new Response(await r.arrayBuffer(), { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", ...cors(env) } });
    } catch {
      return reply(env, { error: "Live avatar server " + id + " is not reachable." }, 502);
    }
  },
};
