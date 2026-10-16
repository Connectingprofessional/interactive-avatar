// Runs the gateway on any computer with Node 18+: `REGISTER_SECRET=choose-a-secret node gateway/dev-server.mjs`
// (Same code as the Cloudflare Worker; the registry is kept in memory, so it forgets servers when restarted. Hosts re-register every few minutes anyway.)
import http from "node:http";
import worker from "./worker.js";

class MemKV {
  constructor() { this.m = new Map(); }
  async put(k, v, o = {}) { this.m.set(k, { v, exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); }
  async get(k) { const e = this.m.get(k); if (!e) return null; if (e.exp && e.exp < Date.now()) { this.m.delete(k); return null; } return e.v; }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { const keys = []; for (const k of [...this.m.keys()]) if (k.startsWith(prefix) && (await this.get(k)) !== null) keys.push({ name: k }); return { keys }; }
}
const env = { BACKENDS: new MemKV(), REGISTER_SECRET: process.env.REGISTER_SECRET || "", ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || "", ALLOW_HTTP: process.env.ALLOW_HTTP || "", PROBE_PATH: process.env.PROBE_PATH || "" };
if (!env.REGISTER_SECRET) console.warn("REGISTER_SECRET is not set: GPU hosts will not be able to register.");

http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = Buffer.concat(chunks);
  const req = new Request("http://" + (rq.headers.host || "localhost") + rq.url, { method: rq.method, headers: rq.headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : body });
  const r = await worker.fetch(req, env);
  rs.writeHead(r.status, Object.fromEntries(r.headers));
  rs.end(Buffer.from(await r.arrayBuffer()));
}).listen(Number(process.env.PORT || 8787), () => console.log("Gateway on port " + (process.env.PORT || 8787)));
