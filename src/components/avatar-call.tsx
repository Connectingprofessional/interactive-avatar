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
    {
      role: "assistant",
      content: "I'm here. Ask me anything — I'll answer out loud.",
    },
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
    const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
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
      const result = await replyAndSpeak({
        data: { messages: next, voiceId },
      });
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
    setMessages([
      { role: "assistant", content: "Call ended. Start again whenever you want." },
    ]);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6 md:flex-row md:items-stretch md:px-8 md:py-10">
      <p>Halo call UI. See the live preview for the running app.</p>
    </main>
  );
}
