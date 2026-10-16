# Gateway: one stable address, GPU servers that come and go

Free GPU hosts run for a few hours, then stop, and their web address changes each time. The gateway is the
fixed front door. The app always uses ONE address (the gateway); behind it, whichever GPU server is up serves the call.

    your app (GitHub Pages)  ->  gateway (always on, free, no GPU)  ->  GPU host A, B, C ... (come and go)
                  video itself flows directly between the GPU host and the browser

How the "12 hours, then 12 hours" or "4 hours here, 4 hours there" handover works, with no clock to set:
- Every GPU host runs `host_agent.py` next to LiveTalking. It registers while LiveTalking answers and unregisters when it stops.
- Each host has a **priority** (lower number is used first). Example: your own PC = 1, Kaggle = 2, Lightning = 3.
- A new call goes to the best host that is up. If that host dies mid-call, the app reconnects through the same gateway
  address and lands on the next one (a few seconds, it repeats the sentence it was saying).
- To avoid any gap, start the next host a few minutes before the previous one ends. Both register and the priority decides.
- A host that dies without saying goodbye is skipped at once (the gateway checks it) and forgotten after 3 check-ins.

## 1. Deploy the gateway (free)
Option A, Cloudflare Workers free plan (needs a free Cloudflare account):

    npm install -g wrangler
    wrangler login
    cd gateway
    wrangler kv namespace create BACKENDS        # copy the id it prints into wrangler.toml
    wrangler secret put REGISTER_SECRET          # type a long random secret; GPU hosts need the same one
    wrangler deploy                              # prints https://avatar-gateway.YOURNAME.workers.dev

Option B, any always-on computer with Node 18+ (no Cloudflare):

    REGISTER_SECRET=your-long-secret node gateway/dev-server.mjs      # port 8787; put it behind your own https

Edit `ALLOWED_ORIGIN` in `wrangler.toml` to your site, so other sites cannot use your gateway.

## 2. On each GPU host (start LiveTalking first)
    python gateway/host_agent.py --gateway https://avatar-gateway.YOURNAME.workers.dev --secret YOUR_SECRET --id kaggle --priority 2

It needs `cloudflared` for the free tunnel (https://github.com/cloudflare/cloudflared/releases), or
`--tunnel none --public-url https://...` if the host already has a public https address.

## 3. In the app
Identity tab > Live video avatar > Server address: paste the gateway address once. Press Start live avatar.
Check who is up at `https://YOUR-GATEWAY/health`.

## What was tested, and what was not
Tested here with mock LiveTalking servers: registration and secret checks, priority order, health probing, the host agent
(register, unregister, tunnel address parsing with a fake cloudflared), and the app switching from server A to server B
mid-conversation through one gateway address, with video continuing.
Not tested: the real Cloudflare deployment, real LiveTalking, real Kaggle/Lightning hosts.
Known limits: the gateway only brokers the connection; if a host's network blocks UDP, the video will not reach the browser
whatever the gateway does (see "Known risk" in LIVE-AVATAR.md). Cloudflare KV can take up to about a minute to show a new
registration worldwide. Free hosts have their own quotas and terms: read them (Colab free bars web services and proxies).
