"use client";

import { useEffect, useRef, useState } from "react";

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: { [n: number]: { [n: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function VoiceInput({ onText, disabled }: { onText: (text: string) => void; disabled: boolean }) {
  const recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { recognition.current?.abort(); }, []);
  useEffect(() => { if (disabled) recognition.current?.abort(); }, [disabled]);
  function start() {
    if (listening) { recognition.current?.stop(); return; }
    const ctor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!ctor) { setError("Голосовой ввод не поддерживается этим браузером. Введите вопрос текстом."); return; }
    const current = new ctor();
    current.lang = "ru-RU";
    current.interimResults = false;
    current.continuous = false;
    current.onresult = event => { onText(event.results[0][0].transcript.slice(0, 1500)); };
    current.onerror = () => { setError("Не удалось распознать речь. Проверьте доступ к микрофону или введите текст."); setListening(false); };
    current.onend = () => { setListening(false); recognition.current = null; };
    recognition.current = current;
    setError("");
    try { current.start(); setListening(true); } catch { setError("Не удалось включить микрофон."); }
  }
  return <div>
    <button type="button" className="secondary" disabled={disabled} aria-pressed={listening} onClick={start}>{listening ? "Остановить запись" : "Продиктовать вопрос"}</button>
    <p className="quiet">Речь распознаёт сервис браузера. Текст появится в поле; проверьте его перед отправкой.</p>
    {error ? <p className="error" role="status">{error}</p> : null}
  </div>;
}
