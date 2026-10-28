"use client";
import { useEffect, useRef, useState } from "react";
import { ProfessorRealtime } from "./ProfessorRealtime";
import { useProfessorConversation } from "./useProfessorConversation";
import type { Room } from "livekit-client";
const poster = "https://files2.heygen.ai/avatar/v3/f83fffc45faa4368b6db9597e6b323ca_45590/preview_talk_3.webp";
export function LiveAvatarDemo({ channel, answer = "", mode, onQuestion }: { channel: "voice" | "realtime"; answer?: string; mode: "analysis" | "general"; onQuestion: (text: string) => Promise<string | undefined> }) {
  const [phase, setPhase] = useState("Выберите режим чата и начните голосовой разговор."), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);
  const video = useRef<HTMLVideoElement>(null), audio = useRef<HTMLAudioElement>(null), room = useRef<Room>(), timer = useRef<ReturnType<typeof setInterval>>();
  const [spokenQuestion, setSpokenQuestion] = useState(""), [spokenAnswer, setSpokenAnswer] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false), [audioPlaying, setAudioPlaying] = useState(false), [replyAudio, setReplyAudio] = useState("");
  const replyAudioUrl = useRef("");
  const [voiceOnly, setVoiceOnly] = useState(false);
  const videoUnavailable = useRef(false);
  const [saying, setSaying] = useState(false);
  const speechAbort = useRef<AbortController>();
  const speechGeneration = useRef(0), sayingJob = useRef(false);
  const socket = useRef<WebSocket>(), speechDone = useRef<{resolve: () => void; reject: (error: Error) => void}>();
  const generation = useRef(0), starting = useRef(false);
  async function refresh() { try { const r = await fetch("/api/liveavatar", { cache: "no-store" }); const data = await r.json(); videoUnavailable.current = data.videoAvailable === false; setVoiceOnly(data.videoAvailable === false); } catch { setPhase("Сервер недоступен. Попробуйте обновить страницу."); setError(true); } }
  async function release() {
    speechDone.current?.reject(new Error("Озвучивание остановлено")); speechDone.current = undefined; socket.current?.close(); socket.current = undefined;
    clearInterval(timer.current);
    const current = room.current; room.current = undefined;
    setConnected(false); setAudioPlaying(false);
    await current?.disconnect();
    if (video.current) video.current.srcObject = null;
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; audio.current.removeAttribute("src"); }
    await fetch("/api/liveavatar", { method: "DELETE", keepalive: true }).catch(() => {});
  }
  async function stop() { speechAbort.current?.abort(); speechGeneration.current++; generation.current++; setBusy(false); await release(); setPhase("Разговор завершён. Можно начать снова."); }
  useEffect(() => { void refresh(); return () => { if (replyAudioUrl.current) URL.revokeObjectURL(replyAudioUrl.current); speechAbort.current?.abort(); speechGeneration.current++; generation.current++; socket.current?.close(); clearInterval(timer.current); void room.current?.disconnect(); void fetch("/api/liveavatar", { method: "DELETE", keepalive: true }).catch(() => {}); }; }, []);
  async function start(kind: "dialogue" | "professor" = "dialogue"): Promise<WebSocket | undefined> {
    if (starting.current || connected) return;
    starting.current = true;
    const attempt = ++generation.current;
    setBusy(true); setError(false); setSpokenQuestion(""); setSpokenAnswer(""); setPhase("Подключаем видео и голос…");
    try {
      const response = await fetch("/api/liveavatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: kind }), signal: AbortSignal.timeout(60000) }); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (generation.current !== attempt) { await release(); return; }
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const current = new Room(); room.current = current;
      current.on(RoomEvent.TrackSubscribed, track => { if (track.kind === Track.Kind.Video && video.current) track.attach(video.current); if (track.kind === Track.Kind.Audio && audio.current) { track.attach(audio.current); audio.current.muted = false; audio.current.volume = 1; void audio.current.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true)); } });
      current.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!current.canPlaybackAudio));
      current.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "agent-response") return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload));
          if (event.event_type === "avatar.speak_started") setPhase("Консультант отвечает…");
          if (event.event_type === "avatar.speak_ended") setPhase("Слушаю ваш следующий вопрос.");
          if (event.event_type === "user.transcription" && typeof event.text === "string") setSpokenQuestion(event.text);
          if (event.event_type === "avatar.transcription" && typeof event.text === "string") setSpokenAnswer(event.text);
        } catch {}
      });
      current.on(RoomEvent.Disconnected, () => { if (room.current !== current) return; clearInterval(timer.current); setConnected(false); setPhase("Сеанс завершён. Для продолжения начните новый разговор."); void release(); });
      await current.connect(data.url, data.token);
      if (generation.current !== attempt) { await current.disconnect(); return; }
      await current.startAudio().catch(() => setAudioBlocked(true));
      let ws: WebSocket | undefined;
      if (kind === "professor") {
        ws = new WebSocket(data.wsUrl); socket.current = ws;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Канал речи не подключился")), 15000);
          ws!.onmessage = message => { try {
            const event = JSON.parse(message.data);
            if (event.type === "session.state_updated" && event.state === "connected") { clearTimeout(timeout); resolve(); }
            if (event.type === "agent.speak_started") setPhase("Профессор произносит ответ из медицинского чата…");
            if (event.type === "agent.speak_ended") { setPhase("Ответ озвучен."); speechDone.current?.resolve(); speechDone.current = undefined; }
            if (event.type === "error") { const error = new Error(event.error?.message || "Ошибка видеосервиса"); clearTimeout(timeout); reject(error); speechDone.current?.reject(error); speechDone.current = undefined; }
          } catch {} };
          ws!.onerror = () => { clearTimeout(timeout); reject(new Error("Ошибка канала речи")); };
          ws!.onclose = () => { clearTimeout(timeout); reject(new Error("Канал речи закрыт")); speechDone.current?.reject(new Error("Канал речи закрыт")); speechDone.current = undefined; };
        });
      }
      setConnected(true); setPhase("Видео подключено. Включите микрофон и задайте вопрос.");
      const deadline = Date.now() + data.duration * 1000;
      timer.current = setInterval(() => { if (Date.now() >= deadline) void stop(); }, 500);
      return ws;
    } catch (cause) { await release(); setError(true); setPhase(cause instanceof Error ? cause.message : "Не удалось подключиться. Попробуйте ещё раз."); if (kind === "professor") throw cause; }
    finally { if (generation.current === attempt) setBusy(false); starting.current = false; }
  }
  async function sayProfessor(text: string): Promise<void> {
    if (sayingJob.current) throw new Error("Профессор уже отвечает голосом");
    sayingJob.current = true; setSaying(true);
    const speechAttempt = speechGeneration.current;
    const controller = new AbortController(); speechAbort.current = controller;
    try {
    const plain = text.replace(/https?:\/\/\S+/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").trim();
    const pieces: string[] = [];
    let rest = plain;
    while (rest) { let end = Math.min(450, rest.length); if (end < rest.length) { const sentence = Math.max(rest.lastIndexOf(". ", end), rest.lastIndexOf("? ", end), rest.lastIndexOf("! ", end)); const boundary = rest.lastIndexOf(" ", end); if (sentence > 120) end = sentence + 1; else if (boundary > 200) end = boundary; } pieces.push(rest.slice(0,end)); rest = rest.slice(end).trim(); }
    for (const piece of pieces) {
      if (speechGeneration.current !== speechAttempt) throw new Error("Разговор остановлен");
      setPhase("Готовлю голосовой ответ профессора…");
      const timeout = setTimeout(() => controller.abort(), 45000);
      let response: Response;
      try { response = await fetch("/api/avatar-speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: piece }), signal: controller.signal }); } finally { clearTimeout(timeout); }
      if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
      const pcm = new Uint8Array(await response.arrayBuffer());
      if (speechGeneration.current !== speechAttempt) throw new Error("Разговор остановлен");
      const wav = new Uint8Array(44 + pcm.length), view = new DataView(wav.buffer);
      const label = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav[offset+i] = text.charCodeAt(i); };
      label(0,"RIFF"); view.setUint32(4,36+pcm.length,true); label(8,"WAVEfmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,24000,true); view.setUint32(28,48000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); label(36,"data"); view.setUint32(40,pcm.length,true); wav.set(pcm,44);
      if (replyAudioUrl.current) URL.revokeObjectURL(replyAudioUrl.current);
      replyAudioUrl.current = URL.createObjectURL(new Blob([wav], { type: "audio/wav" })); setReplyAudio(replyAudioUrl.current);
      if (pcm.length / 48000 > 48) throw new Error("Фрагмент слишком длинный для пробного сеанса. Полный ответ доступен в письменном чате.");
      await release();
      let ws: WebSocket | undefined;
      if (!videoUnavailable.current) {
        try { ws = await start("professor"); }
        catch { videoUnavailable.current = true; setVoiceOnly(true); }
      }
      if (!ws) {
        setVoiceOnly(true); setError(false); setSpokenAnswer(piece);
        setPhase("Видео недоступно. Профессор отвечает голосом без аватара.");
        const player = audio.current; if (!player) throw new Error("Не найден звуковой плеер");
        player.srcObject = null; player.src = replyAudioUrl.current; player.muted = false; player.volume = 1;
        await new Promise<void>((resolve, reject) => {
          const abort = () => done(new Error("Разговор остановлен"));
          const ended = () => done(); const failed = () => done(new Error("Не удалось воспроизвести звук ответа"));
          const done = (error?: Error) => { player.removeEventListener("ended", ended); player.removeEventListener("error", failed); controller.signal.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
          player.addEventListener("ended", ended); player.addEventListener("error", failed); controller.signal.addEventListener("abort", abort, {once:true});
          if (controller.signal.aborted) { abort(); return; }
          void player.play().catch(() => { setAudioBlocked(true); setPhase("Ответ готов. Нажмите воспроизведение в плеере, чтобы услышать его."); });
        });
        setPhase("Ответ озвучен. Можно задать следующий вопрос.");
        continue;
      }
      if (speechGeneration.current !== speechAttempt) { await release(); throw new Error("Разговор остановлен"); }
      setSpokenAnswer(piece);
      const finished = new Promise<void>((resolve, reject) => { speechDone.current = { resolve, reject }; });
      // Attach a handler immediately so an interrupt cannot produce an unhandled rejection.
      void finished.catch(() => {});
      const eventId = crypto.randomUUID();
      for (let offset = 0; offset < pcm.length; offset += 48000) {
        const chunk = pcm.subarray(offset, offset + 48000); let binary = "";
        for (let i = 0; i < chunk.length; i++) binary += String.fromCharCode(chunk[i]);
        if (ws.readyState !== WebSocket.OPEN) throw new Error("Канал речи прерван");
        ws.send(JSON.stringify({ type: "agent.speak", event_id: eventId, audio: btoa(binary) }));
      }
      ws.send(JSON.stringify({ type: "agent.speak_end", event_id: eventId }));
      await finished;
      await release();
    }
    } finally { if (speechAbort.current === controller) speechAbort.current = undefined; await release(); sayingJob.current = false; setSaying(false); }
  }
  const conversation = useProfessorConversation(onQuestion, sayProfessor, stop);
  const channelNow = useRef(channel);
  useEffect(() => {
    const previous = channelNow.current;
    channelNow.current = channel;
    if (previous === "voice" && channel !== "voice") { void conversation.stop(); void stop(); }
  }, [channel]);
  if (channel === "realtime") return <ProfessorRealtime key={mode} mode={mode} onQuestion={onQuestion} onActive={() => {}} onBeforeStart={() => { if (conversation.active) void conversation.stop(); else if (saying || connected || busy) void stop(); }} />;
  return <section className="avatar-consultant" aria-label="Голосовой разговор с профессором">
    <video ref={video} poster={poster} hidden autoPlay playsInline muted aria-label="Видео цифрового консультанта" />
    <audio ref={audio} controls={voiceOnly} aria-label="Голос профессора" style={voiceOnly ? { width: "100%" } : undefined} autoPlay onPlaying={() => { setAudioPlaying(true); setAudioBlocked(false); }} onPause={() => setAudioPlaying(false)} />
    {connected && <button className="secondary" onClick={async () => { try { await room.current?.startAudio(); if (audio.current) { audio.current.muted = false; audio.current.volume = 1; await audio.current.play(); } setAudioBlocked(false); } catch { setAudioBlocked(true); } }}>{audioBlocked ? "Разрешить воспроизведение звука" : "Включить звук"}</button>}
    {audioBlocked && <p role="alert" className="avatar-status">Для звука нажмите воспроизведение в плеере ответа.</p>}
    {voiceOnly && <p className="avatar-status">Видео сейчас недоступно. Голосовой разговор работает отдельно от аватара.</p>}
    {replyAudio && <details className="avatar-transcript"><summary>Прослушать последний фрагмент ответа</summary><audio controls src={replyAudio} aria-label="Аудио последнего фрагмента ответа" onPlay={() => { if (audio.current) audio.current.muted = true; }} onPause={() => { if (audio.current) audio.current.muted = false; }} onEnded={() => { if (audio.current) audio.current.muted = false; }} style={{ width: "100%" }} /></details>}
    <div className="avatar-toolbar">
      {conversation.active ? <button className="secondary" onClick={() => void conversation.stop()}>Завершить голос</button> : saying || busy || connected ? <button className="secondary" onClick={() => void stop()}>Остановить ответ</button> : <button onClick={() => void conversation.start()}>{mode === "general" ? "Задать общий вопрос голосом" : "Задать вопрос по документам"}</button>}
    </div>
    {conversation.stage === "listening" && <div className="voice-capture-controls"><meter aria-label="Уровень микрофона" min={0} max={1} value={conversation.level} /><button onClick={conversation.sendQuestion}>Отправить вопрос</button></div>}
    {conversation.active && <p className="voice-step">{{ requesting: "Ожидаю микрофон", listening: "Слушаю", transcribing: "Распознаю речь", thinking: "Готовлю ответ", speaking: "Отвечаю", idle: "" }[conversation.stage]}</p>}
    <p className="avatar-status">Вопрос распознаётся, профессор отвечает в этой переписке и озвучивает ответ. Следующий вопрос можно задать после паузы.</p>
    {conversation.status && <p className="avatar-status" role="status">{conversation.status}</p>}
    {answer && !conversation.active && <button className="secondary" disabled={busy || connected || saying} onClick={() => void sayProfessor(answer).catch(cause => { setError(true); setPhase(cause.message); })}>Повторить последний ответ голосом</button>}
    {audioPlaying && <p className="avatar-status">Звук воспроизводится.</p>}
    <p className={error ? "avatar-status error" : "avatar-status"} role="status">{phase}</p>
    {(spokenQuestion || spokenAnswer) && <details className="avatar-transcript"><summary>Текст озвученного фрагмента</summary>{spokenQuestion && <p><strong>Вы:</strong> {spokenQuestion}</p>}{spokenAnswer && <p><strong>Профессор:</strong> {spokenAnswer}</p>}</details>}
  </section>;
}
