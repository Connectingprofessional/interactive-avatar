import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Send, Upload } from "lucide-react";
import { replyAndSpeak } from "@/lib/avatar-chat";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string };

const PRESETS = [
  { id: "maya", name: "Maya", src: "/avatars/maya.jpg" },
  { id: "kai", name: "Kai", src: "/avatars/kai.jpg" },
  { id: "aria", name: "Aria", src: "/avatars/aria.jpg" },
] as const;

const VOICES = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
] as const;

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognizer(): SpeechRec | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function AvatarCall() {
  const [avatarSrc, setAvatarSrc] = useState<string>(PRESETS[0].src);
  const [avatarName, setAvatarName] = useState("Maya");
  const [voiceId, setVoiceId] = useState("eve");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "I'm here. Ask me anything. I'll answer out loud." },
  ]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micHint, setMicHint] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      recRef.current?.stop();
    };
  }, []);

  function speakFallback(text: string) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }

  async function playReply(text: string, audioBase64: string | null) {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    if (!audioBase64) {
      speakFallback(text);
      return;
    }
    const audio = new Audio("data:audio/mpeg;base64," + audioBase64);
    audioRef.current = audio;
    audio.onplay = () => setSpeaking(true);
    audio.onended = () => setSpeaking(false);
    audio.onerror = () => {
      setSpeaking(false);
      speakFallback(text);
    };
    try {
      await audio.play();
    } catch {
      speakFallback(text);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setDraft("");
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setBusy(true);
    try {
      const result = await replyAndSpeak({ data: { messages: next, voiceId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: result.text }]);
      await playReply(result.text, result.audioBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = getRecognizer();
    if (!rec) {
      setMicHint("This browser can't capture speech. Type instead.");
      return;
    }
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const said = ev.results[0]?.[0]?.transcript ?? "";
      setListening(false);
      if (said.trim()) void send(said);
    };
    rec.onerror = () => {
      setListening(false);
      setMicHint("Microphone blocked or unavailable.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setMicHint(null);
    setListening(true);
    rec.start();
  }

  function onUpload(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarSrc(reader.result);
        setAvatarName("You");
      }
    };
    reader.readAsDataURL(file);
  }

  function hangUp() {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    recRef.current?.stop();
    setSpeaking(false);
    setListening(false);
    setMessages([{ role: "assistant", content: "Call ended. Start again whenever you want." }]);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6 md:flex-row md:px-8 md:py-10">
      <section className="flex flex-1 flex-col items-center justify-between rounded-3xl border border-line bg-surface px-5 py-6">
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="font-display text-3xl leading-none text-fg">Halo</p>
            <p className="mt-1 text-sm text-muted">Live avatar call</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs text-live">
            <span className="size-2 rounded-full bg-live" />
            {busy ? "Thinking" : speaking ? "Speaking" : listening ? "Listening" : "Ready"}
          </span>
        </div>
        <div className="relative my-8 grid place-items-center">
          <div className={"absolute size-72 rounded-full border-2 border-accent/70 md:size-80 " + (speaking ? "speaking-ring" : "opacity-40")} />
          <img src={avatarSrc} alt={avatarName + " avatar"} className="size-64 rounded-full object-cover ring-4 ring-accent md:size-72" />
        </div>
        <div className="flex w-full flex-col items-center gap-4">
          <p className="text-sm text-muted">{avatarName}</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={toggleMic} disabled={busy} aria-label={listening ? "Stop microphone" : "Talk"} className="grid size-14 place-items-center rounded-full bg-surface-2 text-fg disabled:opacity-40">
              {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>
            <button type="button" onClick={hangUp} aria-label="End call" className="grid size-14 place-items-center rounded-full bg-accent text-accent-ink">
              <PhoneOff className="size-5" />
            </button>
          </div>
          {micHint ? <p className="text-center text-xs text-muted">{micHint}</p> : null}
        </div>
      </section>
      <section className="flex w-full flex-col rounded-3xl border border-line bg-surface md:w-88">
        <div className="border-b border-line p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Avatar</p>
          <div className="mt-3 flex gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => { setAvatarSrc(p.src); setAvatarName(p.name); }} className={"overflow-hidden rounded-full ring-2 " + (avatarSrc === p.src ? "ring-accent" : "ring-transparent")} aria-label={p.name}>
                <img src={p.src} alt="" className="size-12 object-cover" />
              </button>
            ))}
            <label className="grid size-12 cursor-pointer place-items-center rounded-full bg-surface-2 text-fg">
              <Upload className="size-4" />
              <span className="sr-only">Upload your photo</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
            </label>
          </div>
          <label className="mt-4 block text-xs text-muted">
            Voice
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-fg">
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div ref={listRef} className="flex max-h-160 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <p key={i + m.role} className={"max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed " + (m.role === "user" ? "ml-auto bg-accent text-accent-ink" : "bg-surface-2 text-fg")}>{m.content}</p>
          ))}
          {busy ? <p className="text-xs text-muted">Composing a reply.</p> : null}
          {error ? <p className="text-xs text-accent">{error}</p> : null}
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a question" className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-3 text-sm text-fg outline-none" />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </form>
      </section>
    </main>
  );
}
