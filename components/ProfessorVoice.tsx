"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AgentManager } from "@d-id/client-sdk";

export type ProfessorSpeaker = { speak: (text: string) => void; stop: () => void; enableAudio: () => void };

function spoken(text: string) {
  return text.replace(/https?:\/\/\S+/g, "ссылка в тексте ответа")
    .replace(/ATLAXIS/gi, "Атлаксис").replace(/[#*|]/g, "").trim();
}

export const ProfessorVoice = forwardRef<ProfessorSpeaker>(function ProfessorVoice(_, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const manager = useRef<AgentManager | null>(null);
  const generation = useRef(0);
  const modeRef = useRef<"off" | "audio" | "video">("off");
  const [mode, setMode] = useState<"off" | "audio" | "video">("off");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const agentId = process.env.NEXT_PUBLIC_DID_AGENT_ID;
  const clientKey = process.env.NEXT_PUBLIC_DID_CLIENT_KEY;

  function stop() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    manager.current?.interrupt();
  }
  function disable() {
    generation.current++;
    stop();
    const active = manager.current;
    manager.current = null;
    void active?.disconnect().catch(() => {});
    if (video.current) video.current.srcObject = null;
    modeRef.current = "off";
    setMode("off");
    setConnecting(false);
  }

  useImperativeHandle(ref, () => ({ stop, enableAudio() {
    if (modeRef.current !== "off" || connecting) return;
    if (typeof speechSynthesis === "undefined") {
      setError("Голос браузера недоступен. Включите видеоаватара для озвучивания."); return;
    }
    modeRef.current = "audio"; setMode("audio");
  }, speak(text) {
    const input = spoken(text);
    if (!input || modeRef.current === "off") return;
    if (modeRef.current === "video" && manager.current) {
      manager.current.interrupt();
      void manager.current.speak({ type: "text", input, sentiment: "professional" })
        .catch(() => setError("Видео не смогло озвучить ответ. Текст ответа сохранён в чате."));
    } else if (modeRef.current === "audio" && typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(input);
      utterance.lang = "ru-RU";
      utterance.rate = 0.95;
      const russian = speechSynthesis.getVoices().find(v => v.lang.startsWith("ru"));
      if (russian) utterance.voice = russian;
      utterance.onerror = () => setError("Не удалось озвучить ответ. Он доступен в чате.");
      speechSynthesis.speak(utterance);
    }
  }}));

  useEffect(() => () => {
    generation.current++;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    void manager.current?.disconnect().catch(() => {});
    manager.current = null;
  }, []);

  async function connect() {
    if (!agentId || !clientKey || connecting || manager.current) return;
    const token = ++generation.current;
    setConnecting(true);
    setError("");
    let session: AgentManager | null = null;
    try {
      const sdk = await import("@d-id/client-sdk");
      session = await sdk.createAgentManager(agentId, {
        auth: { type: "key", clientKey },
        callbacks: {
          onSrcObjectReady(stream) {
            if (token !== generation.current || !video.current) return;
            video.current.srcObject = stream;
            void video.current.play().catch(() => setError("Нажмите воспроизведение на видео, чтобы включить звук."));
          },
          onConnectionStateChange(state) {
            if (token === generation.current && (state === "disconnected" || state === "fail" || state === "closed")) {
              generation.current++;
              const failed = manager.current;
              manager.current = null;
              void failed?.disconnect().catch(() => {});
              modeRef.current = "off";
              setMode("off");
              setConnecting(false);
              setError("Соединение с аватаром закрыто. Текстовый чат продолжает работать.");
            }
          },
        },
      });
      if (token !== generation.current) { await session.disconnect(); return; }
      manager.current = session;
      await session.connect();
      if (token !== generation.current) { await session.disconnect(); return; }
      modeRef.current = "video";
      setMode("video");
    } catch {
      void session?.disconnect().catch(() => {});
      if (token === generation.current) {
        manager.current = null;
        setError("Аватар недоступен. Проверьте ключ, разрешённый домен и кредиты D-ID. Можно продолжить текстом.");
      }
    } finally {
      if (token === generation.current) setConnecting(false);
    }
  }

  return <section className="professor-voice" aria-label="Голос и видео Профессора">
    <video ref={video} autoPlay playsInline controls hidden={mode !== "video" && !connecting} aria-label="Цифровой аватар Профессора" />
    <div className="voice-actions">
      {mode === "off" && !connecting ? <>
        <button type="button" className="secondary" onClick={() => {
          if (!("speechSynthesis" in window)) { setError("Озвучивание не поддерживается браузером."); return; }
          setError(""); modeRef.current = "audio"; setMode("audio");
        }}>Включить озвучку</button>
        {agentId && clientKey ? <button type="button" onClick={() => void connect()}>Включить видеоаватара</button> : null}
      </> : <>
        <button type="button" className="secondary" onClick={stop}>Остановить речь</button>
        <button type="button" className="secondary" onClick={disable}>{connecting ? "Отменить подключение" : "Выключить"}</button>
      </>}
    </div>
    <p className="quiet">Цифровой персонаж. Озвучиваются новые ответы этого чата. Видео передаёт текст ответов в D-ID за рубеж; озвучка браузера зависит от вашего устройства и его голосового сервиса.</p>
    {connecting ? <p role="status">Подключаем аватара…</p> : null}
    {error ? <p className="error" role="status">{error}</p> : null}
  </section>;
});
