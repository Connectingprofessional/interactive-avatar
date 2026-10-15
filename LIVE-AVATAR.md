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
