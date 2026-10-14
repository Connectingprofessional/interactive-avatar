import { createServerFn } from "@tanstack/react-start";

type Turn = { role: "user" | "assistant"; content: string };

const VOICES = new Set(["eve", "ara", "rex", "sal"]);

export const replyAndSpeak = createServerFn({ method: "POST" })
  .validator((input: { messages?: Turn[]; voiceId?: string }) => {
    const raw = Array.isArray(input?.messages) ? input.messages : [];
    const messages = raw
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-8)
      .map((m) => ({
        role: m.role,
        content: m.content.trim().slice(0, 700),
      }))
      .filter((m) => m.content.length > 0);
    if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
      throw new Error("Say something first.");
    }
    const voice = VOICES.has(input?.voiceId ?? "") ? (input!.voiceId as string) : "eve";
    return { messages, voice };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Voice chat is unavailable right now." };
    }

    const chatRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 180,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
              "You are a live video-call avatar. Reply in 1\u20133 short spoken sentences. No markdown, no lists, no stage directions. Be direct and useful.",
          },
          ...data.messages,
        ],
      }),
    });

    if (!chatRes.ok) {
      return { ok: false as const, error: `Could not reach the model (${chatRes.status}).` };
    }

    const chatBody = (await chatRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (chatBody.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return { ok: false as const, error: "The avatar had nothing to say. Try again." };
    }

    const speech = text.slice(0, 500);
    const ttsRes = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text: speech, voice_id: data.voice }),
    });

    if (!ttsRes.ok) {
      return { ok: true as const, text, audioBase64: null as string | null };
    }

    const bytes = new Uint8Array(await ttsRes.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { ok: true as const, text, audioBase64: btoa(binary) };
  });
