#!/usr/bin/env python3
"""Run this on each GPU host (Kaggle, Lightning, your PC...) next to LiveTalking. Python 3.8+, standard library only.

It (1) opens a free Cloudflare quick tunnel to LiveTalking so the host gets a public https address,
(2) tells your gateway "I am up at this address" every few minutes, and (3) says goodbye when it stops.
It only registers while LiveTalking is actually answering, so the gateway never sends calls to a half-started host.

Example (start LiveTalking first, in another terminal):
    python host_agent.py --gateway https://avatar-gateway.YOURNAME.workers.dev --secret YOUR_SECRET --id kaggle --priority 2

Needs the `cloudflared` program for the tunnel (https://github.com/cloudflare/cloudflared/releases), or pass
--tunnel none --public-url https://your-own-address if the host already has a public https address.
"""
import argparse, atexit, json, os, re, signal, subprocess, sys, threading, time, urllib.request, urllib.error

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def post(gateway, secret, path, body):
    req = urllib.request.Request(gateway.rstrip("/") + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + secret})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode() or "{}")


def livetalking_up(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/index.html" % port, timeout=3):
            return True
    except Exception:
        return False


def start_tunnel(binary, port):
    p = subprocess.Popen([binary, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:%d" % port],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    found = {}

    def reader():
        for line in p.stdout:
            m = URL_RE.search(line)
            if m and "url" not in found:
                found["url"] = m.group(0)
    threading.Thread(target=reader, daemon=True).start()
    for _ in range(90):
        if "url" in found:
            return p, found["url"]
        if p.poll() is not None:
            break
        time.sleep(1)
    p.terminate()
    raise SystemExit("Could not get a tunnel address from cloudflared.")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--gateway", default=os.environ.get("GATEWAY_URL", ""), help="gateway address")
    a.add_argument("--secret", default=os.environ.get("REGISTER_SECRET", ""), help="the gateway's REGISTER_SECRET")
    a.add_argument("--id", required=True, help="short name for this host, e.g. kaggle")
    a.add_argument("--priority", type=int, default=10, help="lower number is used first")
    a.add_argument("--port", type=int, default=8010, help="LiveTalking port")
    a.add_argument("--tunnel", choices=["cloudflared", "none"], default="cloudflared")
    a.add_argument("--cloudflared", default="cloudflared", help="path to the cloudflared program")
    a.add_argument("--public-url", default="", help="with --tunnel none: the host's public https address")
    a.add_argument("--interval", type=int, default=300, help="seconds between check-ins")
    a = a.parse_args()
    if not a.gateway or not a.secret:
        raise SystemExit("Give --gateway and --secret (or set GATEWAY_URL and REGISTER_SECRET).")

    tun = None
    if a.tunnel == "cloudflared":
        tun, url = start_tunnel(a.cloudflared, a.port)
    else:
        url = a.public_url
        if not url:
            raise SystemExit("--tunnel none needs --public-url")
    print("Public address:", url)

    def bye(*_):
        try:
            post(a.gateway, a.secret, "/unregister", {"id": a.id})
            print("Unregistered.")
        except Exception:
            pass
        if tun and tun.poll() is None:
            tun.terminate()
    atexit.register(bye)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    announced = False
    try:
        while True:
            if livetalking_up(a.port):
                try:
                    post(a.gateway, a.secret, "/register", {"id": a.id, "url": url, "priority": a.priority, "ttl": a.interval * 3})
                    if not announced:
                        print("Registered with the gateway as '%s' (priority %d)." % (a.id, a.priority)); announced = True
                except (urllib.error.URLError, OSError) as e:
                    print("Could not reach the gateway:", e); announced = False
            else:
                if announced: print("LiveTalking stopped answering; waiting.")
                announced = False
            if tun and tun.poll() is not None:
                raise SystemExit("The tunnel stopped.")
            time.sleep(a.interval)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
