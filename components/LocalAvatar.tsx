"use client";
import { useEffect, useRef, useState } from "react";
const stages: Record<string, string> = { queued: "Ожидание", voice: "Создаём голос Кристи", preparing: "Подготавливаем движение", lips: "Синхронизируем губы", done: "Видео готово", error: "Ошибка генерации" };
export function LocalAvatar({ answer }: { answer: string }) {
  const [text, setText] = useState("Здравствуйте! Я Кристи.");
  const [job, setJob] = useState("");
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState("/avatar/kristi-demo.mp4");
  const player = useRef<HTMLVideoElement>(null);
  const renderEnabled = process.env.NEXT_PUBLIC_LOCAL_AVATAR_RENDER === "true";
  const busy = renderEnabled && ["queued", "voice", "preparing", "lips"].includes(stage);
  useEffect(() => { const previous = sessionStorage.getItem("atlaxis-local-avatar-job"); if (previous && renderEnabled) { setJob(previous); setStage("queued"); } }, []);
  useEffect(() => { void fetch("/api/avatar").then(r => { setReady(r.ok && process.env.NEXT_PUBLIC_LOCAL_AVATAR_RENDER === "true"); }).catch(() => setReady(false)); }, []);
  useEffect(() => {
    if (!job || !busy) return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/avatar?job=${job}`, { cache: "no-store" });
        const result = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(result.error ?? "Задача недоступна.");
        setStage(result.stage); setElapsed(result.elapsed);
        if (result.stage === "done") setSource(`/api/avatar?job=${job}&video=1`);
        if (result.error) setError(result.error);
      } catch (reason) { if (!stopped) { setError(reason instanceof Error ? reason.message : "Ошибка соединения."); setStage("error"); } }
    };
    void check(); const timer = setInterval(() => void check(), 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [job, busy]);
  async function generate() {
    setError(""); setStage("queued");
    try {
      const response = await fetch("/api/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось запустить видео.");
      sessionStorage.setItem("atlaxis-local-avatar-job", result.id); setJob(result.id); setStage(result.stage);
    } catch (reason) { setStage("error"); setError(reason instanceof Error ? reason.message : "Ошибка генерации."); }
  }
  return <section className="local-avatar" aria-label="Локальная видеопроба Кристи">
    <details open><summary>Кристи · локальная видеопроба</summary>
      <video ref={player} key={source} src={source} controls playsInline preload="metadata" aria-label="Видео Кристи" />
      <audio controls preload="metadata" src="/avatar/kristi-local-voice.wav" aria-label="Локальный голос Кристи" style={{ width: "100%", marginTop: 8 }} />
      <p className="quiet">Новый локальный голос: «Здравствуйте!». Можно послушать без генерации видео.</p>
      <p className="quiet">{source.startsWith("/avatar/") ? "Предварительно записанный пример. Новый локальный голос доступен в аудиоплеере." : "Новое видео создано под введённый текст."}</p>
      <textarea aria-label="Текст для Кристи" rows={2} value={text} maxLength={240} onChange={e => setText(e.target.value)} disabled={busy || !renderEnabled} />
      <div className="local-avatar-actions"><button type="button" onClick={() => void generate()} disabled={!renderEnabled || busy || !text.trim() || text.length > 240 || !ready}>{!renderEnabled ? "Видеогенерация на Mac приостановлена" : busy ? "Создаётся видео…" : "Создать видео Кристи"}</button>
      <button className="secondary" type="button" disabled={!renderEnabled || busy || !answer} onClick={() => { setText(answer); setError(answer.length > 240 ? "Для пробы сократите ответ до 240 символов в поле выше." : ""); }}>Взять ответ профессора</button></div>
      <p className="quiet">{text.length}/240 символов. Обработка на этом Mac, с ожиданием. Это не разговор в реальном времени.</p>
      {!ready ? <p role="status" className="quiet">Генерация видео на Mac приостановлена, чтобы не перегружать память.</p> : null}
      {busy || stage === "done" ? <p role="status" className="quiet">{stages[stage]}{busy ? ` · прошло ${elapsed} с` : ""}</p> : null}
      {error && renderEnabled ? <p className="error" role="alert">{error}</p> : null}
    </details>
  </section>;
}
