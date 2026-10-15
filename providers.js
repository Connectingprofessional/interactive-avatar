/* Live avatar providers for the avatar app.
 *
 * Every provider speaks the same small interface, so the app does not care which one is behind it:
 *   const p = LiveAvatars.create("livetalking", { mount, onStatus, onClose });
 *   await p.connect();                     // opens the live video
 *   await p.speak(float32Samples, rate);   // our own voice (Kokoro / Piper) -> avatar mouth; resolves when it finished talking
 *   p.interrupt();                         // barge-in
 *   await p.disconnect();
 *
 * No API keys and no paid services: the avatar engine is open source software that you run yourself.
 * Another free engine plugs in by writing one more class with the same four methods.
 */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  async function api(path, body, extra) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(extra || {}) }, body: JSON.stringify(body || {}) });
    let j = {};
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(j.error || j.message || "Server answered " + r.status);
    return j;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
  }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));


  /** Float32 samples at any rate -> 16-bit little-endian PCM at outRate (linear resampling). */
  function toPCM16(f32, rate, outRate) {
    let src = f32;
    if (rate !== outRate) {
      const n = Math.max(1, Math.round((f32.length * outRate) / rate));
      src = new Float32Array(n);
      const k = (f32.length - 1) / Math.max(1, n - 1);
      for (let i = 0; i < n; i++) {
        const p = i * k, a = Math.floor(p), b = Math.min(f32.length - 1, a + 1), t = p - a;
        src[i] = f32[a] * (1 - t) + f32[b] * t;
      }
    }
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) { const s = Math.max(-1, Math.min(1, src[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    return out;
  }
  function wavBlob(pcm16, rate) {
    const buf = new ArrayBuffer(44 + pcm16.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + pcm16.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, pcm16.length * 2, true);
    new Int16Array(buf, 44).set(pcm16);
    return new Blob([buf], { type: "audio/wav" });
  }
  function makeVideo(mount) {
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true;
    v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:none;background:#000";
    v.setAttribute("data-live-avatar", "");
    mount.insertBefore(v, mount.firstChild);
    return v;
  }

  /* ---------------- LiveTalking (open source, self-hosted, WebRTC) ----------------
   * You run https://github.com/lipku/LiveTalking on a GPU machine and set LIVETALKING_URL in .env.
   * The browser sends a WebRTC offer (through server.py), watches the video, and we push our own voice as a WAV file. */
  class LiveTalking {
    constructor(o) { this.o = o; this.closed = false; this.backend = 0; }
    status(t) { try { this.o.onStatus && this.o.onStatus(t); } catch { /* */ } }
    hdr() { return { "X-LT-Backend": String(this.backend) }; }

    async connect() {
      this.status("Connecting to LiveTalking…");
      if (!this.video) this.video = makeVideo(this.o.mount);
      const pc = (this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }));
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (e) => { if (this.video && this.video.srcObject !== e.streams[0]) this.video.srcObject = e.streams[0]; };
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc || this.closed) return;
        if (["failed", "closed"].includes(pc.connectionState)) this.recover();
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((res) => {
        if (pc.iceGatheringState === "complete") return res();
        pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && res();
        setTimeout(res, 2500);
      });
      const j = await api("/api/livetalking/offer", { sdp: pc.localDescription.sdp, type: pc.localDescription.type });
      const a = j.data && j.data.sdp ? j.data : j;                    // accept both plain and {code,data} replies
      this.sid = a.sessionid;
      this.backend = j.backend || 0;                                  // which server the app picked (priority order)
      await pc.setRemoteDescription({ sdp: a.sdp, type: a.type || "answer" });
      this.status(this.backend ? "Live (backup server " + (this.backend + 1) + ")" : "Live");
    }

    /** the server died or the connection broke: join the next server that is up, in priority order */
    reconnect() {
      if (this._re) return this._re;
      this._re = (async () => {
        for (let i = 0; i < 4 && !this.closed; i++) {
          this.status("Live avatar lost. Switching to the next server…");
          try { this.pc && (this.pc.onconnectionstatechange = null, this.pc.close()); } catch { /* */ }
          try { await this.connect(); return true; } catch { await wait(2000); }
        }
        return false;
      })().finally(() => { this._re = null; });
      return this._re;
    }
    async recover() {
      if (!(await this.reconnect()) && !this.closed) this.lost("No live avatar server is reachable. Back to the built-in avatar.");
    }

    async post(pcm, rate) {
      const fd = new FormData();
      fd.append("sessionid", String(this.sid));
      fd.append("file", wavBlob(pcm, rate), "speech.wav");
      const r = await fetch("/api/livetalking/humanaudio", { method: "POST", body: fd, headers: this.hdr() });
      if (!r.ok) throw new Error("LiveTalking refused the audio (" + r.status + ")");
    }

    async speak(f32, rate) {
      const pcm = toPCM16(f32, rate, rate);
      const seconds = pcm.length / rate;
      try { await this.post(pcm, rate); }
      catch (e) {                                                     // server gone mid-call: switch and say the sentence again
        if (this.closed || !(await this.reconnect())) throw e;
        await this.post(pcm, rate);
      }
      // wait until it stops talking: poll, with a cap so the conversation can never hang
      const end = Date.now() + seconds * 1000 + 8000;
      await wait(Math.min(1200, seconds * 1000));
      while (!this.closed && Date.now() < end && !this.cancel) {
        let speaking = true;
        try { const s = await api("/api/livetalking/is_speaking", { sessionid: this.sid }, this.hdr()); speaking = !!(s.data !== undefined ? s.data : s); } catch { break; }
        if (!speaking) break;
        await wait(250);
      }
      this.cancel = false;
    }

    interrupt() {
      this.cancel = true;
      if (this.sid !== undefined) api("/api/livetalking/interrupt_talk", { sessionid: this.sid }, this.hdr()).catch(() => {});
    }

    lost(msg) { if (this.closed) return; this.closed = true; this.cleanup(); this.o.onClose && this.o.onClose(msg); }
    cleanup() {
      try { this.pc && (this.pc.onconnectionstatechange = null, this.pc.close()); } catch { /* */ }
      if (this.video) { this.video.srcObject = null; this.video.remove(); this.video = null; }
    }
    async disconnect() { this.closed = true; this.cleanup(); }
    beacon() { /* nothing to stop on the server: closing the connection ends the session */ }
  }

  const KINDS = {
    livetalking: { label: "Live video avatar: LiveTalking (free, open source)", cls: LiveTalking },
  };

  window.LiveAvatars = {
    kinds: KINDS,
    /** which engines the local server has configured; resolves null when there is no server (GitHub Pages, file://) */
    async config() {
      try {
        if (location.protocol === "file:") return null;
        const r = await fetch("/api/avatar/config", { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        return j && j.livetalking ? j : null;
      } catch { return null; }
    },
    create(kind, opts) {
      const k = KINDS[kind];
      if (!k) throw new Error("Unknown live avatar engine: " + kind);
      return new k.cls(opts);
    },
    _test: { toPCM16, wavBlob },
  };
})();
