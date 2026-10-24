"use client";

import { useEffect, useRef, useState } from "react";
import { ProfessorRealtime, type VoicePhase } from "@/lib/professor-realtime";

export function ProfessorConversation({ onQuestion, onSpeech, onEnableAudio }: {
  onQuestion: (text: string) => void;
  onSpeech: () => void;
  onEnableAudio: () => void;
}) {
  const client = useRef<ProfessorRealtime | null>(null);
  const callbacks = useRef({ onQuestion, onSpeech, onEnableAudio });
  callbacks.current = { onQuestion, onSpeech, onEnableAudio };
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/professor/realtime").then(r => r.json()).then(body => {
      if (active) setEnabled(body.enabled === true);
    }).catch(() => {});
    return () => { active = false; client.current?.stop(); };
  }, []);
  async function start() {
    if (phase !== "off") {
      client.current?.stop(); callbacks.current.onSpeech(); setPhase("off"); return;
    }
    setError("");
    callbacks.current.onEnableAudio();
    const connection = new ProfessorRealtime(); client.current = connection;
    await connection.start({
      onTranscript: text => callbacks.current.onQuestion(text),
      onSpeech: () => callbacks.current.onSpeech(),
      onPhase: setPhase,
      onError: setError,
    });
  }
  if (!enabled) return null;
  const status = phase === "connecting" ? "Подключение…" : phase === "listening" ? "Слушаю вас" : phase === "transcribing" ? "Распознаю вопрос…" : "";
  return <section className="professor-conversation" aria-label="Живой разговор с Профессором">
    <button type="button" onClick={() => void start()} aria-pressed={phase !== "off"}>{phase === "off" ? "Начать живой разговор" : "Завершить разговор"}</button>
    <p className="quiet">При включении микрофон передаёт речь в OpenAI. Вопросы после паузы отправляются Профессору автоматически. Видео включается отдельно.</p>
    {status ? <p role="status">{status}</p> : null}
    {error ? <p className="error" role="status">{error}</p> : null}
  </section>;
}
