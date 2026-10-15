#!/usr/bin/env python3
"""Local server for the avatar app. Python 3.8+, standard library only. No API keys, nothing paid.

It does two jobs on one port:
  1. serves the static app (index.html, avatars/, providers.js), like `python -m http.server`
  2. optional: passes the browser's calls through to a LiveTalking server you run yourself
     (free open-source realtime talking-head, https://github.com/lipku/LiveTalking), so the browser needs no CORS setup

Backend routes:
  GET  /api/avatar/config            is a live avatar engine configured?
  GET  /api/livetalking/health       which configured servers are up right now
  POST /api/livetalking/<route>      pass-through to LIVETALKING_URL (offer, human, humanaudio, interrupt_talk, is_speaking)

Settings (environment variables or a `.env` file next to this script):
  LIVETALKING_URL   one URL, or several separated by commas in priority order, e.g.
                    http://127.0.0.1:8010,https://backup.example.com  (empty = built-in avatar only)
  backends.txt      optional file, one URL per line in priority order; re-read on every call, so you can
                    swap a changed address without restarting. If present it replaces LIVETALKING_URL.
                    The first server that answers is used; if it dies mid-call the app switches to the next.
  PORT              default 8000
  HOST              default 127.0.0.1 (keep it: this server is meant for your own computer)
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LIVETALKING_ROUTES = {"offer", "human", "humanaudio", "interrupt_talk", "is_speaking", "set_audiotype"}


def load_env():
    f = ROOT / ".env"
    if not f.is_file():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
LIVETALKING_URL = os.environ.get("LIVETALKING_URL", "").strip()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def backends():
    """LiveTalking servers in priority order (backends.txt wins over LIVETALKING_URL)."""
    urls = []
    f = ROOT / "backends.txt"
    if f.is_file():
        urls = [l.strip() for l in f.read_text(encoding="utf-8").splitlines() if l.strip() and not l.strip().startswith("#")]
    if not urls:
        urls = [u.strip() for u in LIVETALKING_URL.split(",") if u.strip()]
    return [u.rstrip("/") for u in urls if u.lower().startswith(("http://", "https://"))]


def is_up(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url + "/", method="GET"), timeout=2.5):
            return True
    except urllib.error.HTTPError:
        return True                                   # it answered, so it is alive
    except (urllib.error.URLError, OSError, ValueError):
        return False


def first_up():
    for i, u in enumerate(backends()):
        if is_up(u):
            return i
    return None


class UpstreamError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    # ---------- safety ----------
    def host_ok(self):
        h = self.headers.get("Host") or ""
        name = h.split("]")[0] + "]" if h.startswith("[") else h.split(":")[0]
        return HOST not in ("127.0.0.1", "localhost", "::1") or name in LOCAL_HOSTS   # blocks DNS rebinding

    def origin_ok(self):
        o = self.headers.get("Origin")
        return not o or urlparse(o).netloc == self.headers.get("Host")                # same-origin only

    def blocked_path(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        for p in parts:
            if (p.startswith(".") and p != ".nojekyll") or p.lower().endswith((".py", ".env", ".bat", ".md")):
                return True
        return False

    # ---------- helpers ----------
    def send_json(self, status, obj):
        b = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 25 * 1024 * 1024:
            raise UpstreamError(413, "Request too large")
        return self.rfile.read(n) if n else b""

    # ---------- routes ----------
    def do_GET(self):
        if not self.host_ok():
            return self.send_json(403, {"error": "Bad host"})
        path = urlparse(self.path).path
        if path == "/api/avatar/config":
            return self.send_json(200, {"livetalking": {"enabled": bool(backends()), "servers": len(backends())}})
        if path == "/api/livetalking/health":
            return self.send_json(200, {"servers": [{"index": i, "up": is_up(u)} for i, u in enumerate(backends())]})
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "Not found"})
        if self.blocked_path():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.blocked_path():
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        if not (self.host_ok() and self.origin_ok()):
            return self.send_json(403, {"error": "Forbidden"})
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/livetalking/"):
                route = path.rsplit("/", 1)[1]
                servers = backends()
                if route not in LIVETALKING_ROUTES or not servers:
                    return self.send_json(404, {"error": "LiveTalking is not configured (set LIVETALKING_URL or backends.txt)."})
                if route == "offer":                       # a new call: use the first server that is up
                    idx = first_up()
                    if idx is None:
                        raise UpstreamError(502, "No live avatar server is reachable right now.")
                else:                                      # later calls go to the server this call started on
                    try:
                        idx = int(self.headers.get("X-LT-Backend", "0"))
                    except ValueError:
                        idx = 0
                    if not 0 <= idx < len(servers):
                        raise UpstreamError(409, "That live avatar server is no longer configured.")
                req = urllib.request.Request(
                    "%s/%s" % (servers[idx], route), data=self.read_body(), method="POST",
                    headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        out, ctype, status = r.read(), r.headers.get("Content-Type", "application/json"), r.status
                except urllib.error.HTTPError as e:
                    out, ctype, status = e.read(), e.headers.get("Content-Type", "text/plain"), e.code
                except (urllib.error.URLError, OSError) as e:
                    raise UpstreamError(502, "Live avatar server %d is not reachable: %s" % (idx + 1, getattr(e, "reason", e)))
                if route == "offer" and status == 200:
                    try:
                        j = json.loads(out); j["backend"] = idx; out = json.dumps(j).encode("utf-8")
                    except ValueError:
                        pass
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)
                return
            return self.send_json(404, {"error": "Not found"})
        except UpstreamError as e:
            return self.send_json(e.status if 400 <= e.status < 600 else 502, {"error": e.message})
        except ValueError:
            return self.send_json(400, {"error": "Bad JSON"})
        except Exception as e:                                        # never leak a traceback to the browser
            sys.stderr.write("server error: %r\n" % (e,))
            return self.send_json(500, {"error": "Server error"})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Avatar app: http://%s:%d" % ("localhost" if HOST == "127.0.0.1" else HOST, PORT))
    print("  Live video avatar (LiveTalking):", ", ".join(backends()) or "off (add LIVETALKING_URL to .env)")
    print("Close this window or press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
