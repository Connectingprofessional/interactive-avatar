# Optional: live video avatar (free, open source)

The app works without this. Out of the box you get the animated-photo avatar with free offline
voice, listening and AI. This adds a more realistic talking-head video, still with no API keys,
no credits and no usage limits.

How it works: the app keeps using your own free brain and voice (Kokoro / Piper). Each spoken
sentence is sent as audio to [LiveTalking](https://github.com/lipku/LiveTalking) (Apache-2.0), an
open-source server that turns audio into a realtime lip-synced face over WebRTC.

## Requirements
- A computer with an NVIDIA GPU to run LiveTalking (wav2lip needs roughly an RTX 3060 or better,
  MuseTalk an RTX 3080 Ti or better, per the project). The software is free; the GPU is the cost.
- Python for `server.py` (already needed for run-local.bat).

## Steps
1. On the GPU machine, install and start LiveTalking as described in its README, for example:
       python app.py --transport webrtc --model wav2lip --avatar_id wav2lip256_avatar1
   It listens on port 8010. Open TCP 8010 and UDP 1-65536 if it is on another machine.
   Make your own avatar from a video at http://SERVER:8010/avatar.html.
2. Copy `.env.example` to `.env` and set `LIVETALKING_URL` (for example http://127.0.0.1:8010).
3. Run `run-local.bat` (or `python server.py`) and open http://localhost:8000.
4. Open Persona > "Connect an AI / offline models" and tick "Natural human voice". Pick a Kokoro voice in the Voice tab.
5. In the Identity tab, under "Live video avatar", press "Start live avatar".

## Notes
- This needs `server.py`, so it does not appear on GitHub Pages. The Pages site keeps the built-in avatar.
- Browser voices cannot be sent to the avatar. A natural voice (Kokoro or Piper) is required.
- `.env` is never served to the browser and is ignored by git.
- Other free engines can be added in `providers.js`: one class with connect, speak, interrupt and disconnect.

## Several servers in a row (failover)
List more than one LiveTalking server and the app keeps going when one stops:
- Put them in `backends.txt` (see `backends.txt.example`), best first, or in `LIVETALKING_URL` separated by commas.
- A new call uses the first server that answers. If it dies mid-call, the app reconnects to the next one,
  repeats the sentence it was saying, and shows "Live (backup server 2)". If none is up it falls back to the
  built-in avatar. Check status at http://localhost:8000/api/livetalking/health.
- This is the only piece that is automatic. Starting LiveTalking on each host and putting its address in the list is up to you.

What a 24-hour relay on free GPU hosts needs to respect:
- Free GPU time is capped, not unlimited. Kaggle's is a weekly quota (about 30 hours reported, not published), so 12 hours
  every day does not fit. Colab's free tier gives no guaranteed GPU, and its terms bar web services and remote proxies on free runtimes.
  Hugging Face ZeroGPU is 5 minutes a day. Read each host's current terms before running a server there.
- Video needs a route to the browser (WebRTC, UDP). Many free notebook tunnels only carry HTTP.
- A host's address usually changes each session, so update `backends.txt` when you start one.
- For a stable all-day service, a GPU machine you own is the dependable free option.

## Use it from the public GitHub Pages site (no server.py)
The Identity tab now has a **Server address** box under "Live video avatar". Paste the address of any LiveTalking
server and press Start. The browser talks to it directly (LiveTalking allows cross-site calls), so this works on the
Pages site too. The address is remembered in your browser only.
- The Pages site is https, so the address must be https as well (or `http://localhost...` on your own computer).
  A tunnel gives you an https address, for example `cloudflared tunnel --url http://localhost:8010`.
- Advanced > TURN / STUN servers: optional JSON list for the browser side, e.g.
  `[{"urls":"turn:host:3478","username":"user","credential":"pass"}]`.

## Getting a GPU for free, step by step
LiveTalking's documented setup (from its README), to run on any Linux GPU machine:

    git clone https://github.com/lipku/LiveTalking.git
    conda create -n livetalking python=3.12 && conda activate livetalking
    pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128
    cd LiveTalking && pip install -r requirements.txt
    # download wav2lip256.pth -> models/wav2lip.pth, and wav2lip256_avatar1 -> data/avatars/ (links in its README)
    python app.py --transport webrtc --model wav2lip --avatar_id wav2lip256_avatar1

Pick where to run it, in this order:
1. **Your own PC with an NVIDIA GPU** (RTX 3060 or better for Wav2Lip). Free, no limit.
2. **Lightning AI free plan**: about 22 T4 hours a month according to a third-party guide (Feb 2026), restarting every 4 hours. Check their current terms before exposing a server.
3. **Kaggle notebooks**: free T4/P100 with a weekly quota. I could not read Kaggle's terms about running servers, so read them before you try.
4. **Not Google Colab free**: its FAQ bars web-service offerings and remote proxies on free runtimes.

Known risk: video travels over WebRTC (UDP). A server in a notebook or behind a home router may not be reachable by your
browser even when the web address works. If the video never appears, a TURN relay is needed on both sides, and I could not
confirm that LiveTalking can be given TURN settings. Test this first on a short session.

## One stable address for changing GPU hosts (the "gateway")
For the 12-hours-then-12-hours idea, use the gateway in `gateway/`: the app keeps one fixed address, GPU hosts register
themselves when they start, and the app moves to the next one if the current one stops. See `gateway/README.md`.
