#!/usr/bin/env bash
# Start LiveTalking and register this machine with your gateway, in one command. Run it again after every session restart.
#
#   GATEWAY_URL=https://avatar-gateway.YOURNAME.workers.dev REGISTER_SECRET=your-secret HOST_ID=lightning PRIORITY=3 \
#     bash gateway/start_host.sh /path/to/LiveTalking
#
# Needs: LiveTalking already installed and its models in place, `cloudflared` on PATH, python3.
# Optional: LT_ARGS="--transport webrtc --model wav2lip --avatar_id wav2lip256_avatar1"   LT_PORT=8010   TUNNEL=cloudflared|none  PUBLIC_URL=https://...
set -u
LT_DIR="${1:-$HOME/LiveTalking}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${LT_PORT:-8010}"
ARGS="${LT_ARGS:---transport webrtc --model wav2lip --avatar_id wav2lip256_avatar1}"
: "${GATEWAY_URL:?set GATEWAY_URL}"; : "${REGISTER_SECRET:?set REGISTER_SECRET}"; : "${HOST_ID:?set HOST_ID, e.g. lightning}"
[ -f "$LT_DIR/app.py" ] || { echo "No app.py in $LT_DIR. Pass the LiveTalking folder as the first argument."; exit 1; }

cd "$LT_DIR"
# shellcheck disable=SC2086
python3 app.py $ARGS > livetalking.log 2>&1 &
LT_PID=$!
trap 'kill $LT_PID 2>/dev/null' EXIT INT TERM

echo "Waiting for LiveTalking on port $PORT (first start can take a few minutes)..."
for i in $(seq 1 120); do
  if python3 - "$PORT" <<'PY'
import sys, urllib.request
try: urllib.request.urlopen("http://127.0.0.1:%s/index.html" % sys.argv[1], timeout=2); sys.exit(0)
except Exception: sys.exit(1)
PY
  then echo "LiveTalking is up."; break; fi
  kill -0 $LT_PID 2>/dev/null || { echo "LiveTalking stopped. Last lines of livetalking.log:"; tail -20 livetalking.log; exit 1; }
  [ "$i" = 120 ] && { echo "LiveTalking did not answer in time. See $LT_DIR/livetalking.log"; exit 1; }
  sleep 3
done

TUN=(--tunnel "${TUNNEL:-cloudflared}")
[ -n "${PUBLIC_URL:-}" ] && TUN+=(--public-url "$PUBLIC_URL")
python3 "$HERE/host_agent.py" --gateway "$GATEWAY_URL" --secret "$REGISTER_SECRET" --id "$HOST_ID" \
  --priority "${PRIORITY:-10}" --port "$PORT" "${TUN[@]}"
