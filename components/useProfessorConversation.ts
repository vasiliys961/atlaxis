"use client";
import { useEffect, useRef, useState } from "react";
import { VoiceRun, VoiceRuns } from "@/lib/voice-lifecycle";
export function useProfessorConversation(ask: (text: string) => Promise<string | undefined>, say: (text: string) => Promise<void>, stopAvatar: () => Promise<void>) {
  const [active, setActive] = useState(false), [status, setStatus] = useState("");
  const [stage, setStage] = useState<"idle" | "requesting" | "listening" | "transcribing" | "thinking" | "speaking">("idle"), [level, setLevel] = useState(0);
  const finishTurn = useRef<() => void>();
  const runs = useRef(new VoiceRuns());
  const askRef = useRef(ask), sayRef = useRef(say), stopRef = useRef(stopAvatar);
  askRef.current = ask; sayRef.current = say; stopRef.current = stopAvatar;
  async function stop() { runs.current.stop(); setActive(false); setStage("idle"); setLevel(0); setStatus("Голосовой разговор завершён."); await stopRef.current(); }
  useEffect(() => () => runs.current.stop(), []);
  function capture(run: VoiceRun, media: MediaStream, context: AudioContext): Promise<Blob | undefined> {
    media.getAudioTracks().forEach(track => { track.enabled = true; });
    const source = context.createMediaStreamSource(media), analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize), chunks: Blob[] = [];
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    return new Promise((resolve, reject) => {
      let manual = false;
      let speech = false, lastSound = Date.now(); const begun = Date.now(); let settled = false;
      const finish = () => { if (recorder.state === "recording") recorder.stop(); };
      const send = () => { manual = true; finish(); }; finishTurn.current = send;
      const removeCleanup = run.addCleanup(finish);
      const dispose = () => { if (finishTurn.current === send) finishTurn.current = undefined; if (runs.current.owns(run)) setLevel(0); clearInterval(interval); removeCleanup(); source.disconnect(); analyser.disconnect(); media.getAudioTracks().forEach(track => { track.enabled = false; }); };
      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum,n) => sum+n*n,0)/samples.length);
        if (runs.current.owns(run)) setLevel(Math.min(1, rms * 12));
        if (rms > 0.015) { speech = true; lastSound = Date.now(); }
        if (run.stopped || Date.now()-begun > 25000 || (speech && Date.now()-lastSound > 1000)) finish();
      }, 100);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { if (settled) return; settled = true; dispose(); reject(new Error("Ошибка записи микрофона. Начните разговор заново.")); };
      recorder.onstop = () => { if (settled) return; settled = true; dispose(); resolve((speech || (manual && Date.now()-begun>500)) && !run.stopped ? new Blob(chunks, { type: recorder.mimeType }) : undefined); };
      try { recorder.start(250); } catch (error) { settled = true; dispose(); reject(error); }
    });
  }
  async function start() {
    const run = runs.current.begin(); if (!run) return;
    setActive(true); setStage("requesting"); setStatus("Разрешите микрофон. Вопрос будет обработан в выбранном режиме чата.");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("В этом браузере запись голоса недоступна. Откройте приложение в Chrome или Safari.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      run.addCleanup(() => media.getTracks().forEach(track => track.stop()));
      if (!runs.current.owns(run)) return;
      const context = new AudioContext(); run.addCleanup(() => { if (context.state !== "closed") void context.close().catch(() => {}); }); await context.resume();
      while (runs.current.owns(run)) {
        setStage("listening"); setStatus("Слушаю вопрос. После фразы сделайте паузу.");
        const blob = await capture(run, media, context); if (!runs.current.owns(run)) break;
        if (!blob) { setStatus("Не услышал речь. Нажмите кнопку разговора и попробуйте снова."); break; }
        setStage("transcribing"); setStatus("Распознаю вопрос…"); const form = new FormData(); form.set("audio", blob, "question.webm");
        const timeout = setTimeout(() => run.abort.abort(), 35000);
        let response: Response;
        try { response = await fetch("/api/voice-question", { method: "POST", body: form, signal: run.abort.signal }); } finally { clearTimeout(timeout); }
        const result = await response.json(); if (!runs.current.owns(run)) break;
        if (!response.ok) throw new Error(result.error); if (!result.text) continue;
        setStage("thinking"); setStatus("Профессор готовит ответ с контекстом выбранного режима…");
        const reply = await askRef.current(result.text); if (!runs.current.owns(run)) break;
        if (!reply) throw new Error("Профессор не вернул ответ. Проверьте сообщение в письменном чате.");
        setStage("speaking"); setStatus("Профессор отвечает. Полный текст и источники — в чате.");
        await sayRef.current(reply);
      }
    } catch (cause) {
      if (runs.current.current === run) {
        const messages: Record<string, string> = {
          NotAllowedError: "Доступ к микрофону не разрешён. Разрешите его для этой страницы и повторите.",
          NotFoundError: "Микрофон не найден. Подключите его и повторите.",
          NotReadableError: "Не удалось открыть микрофон. Проверьте, не занят ли он другим приложением.",
          AbortError: "Превышено время ожидания. Начните разговор заново.",
        };
        setStatus(cause instanceof Error ? messages[cause.name] || cause.message : "Не удалось начать голосовой разговор.");
        await stopRef.current();
      }
    } finally { if (runs.current.finish(run)) { setActive(false); setStage("idle"); setLevel(0); } }
  }
  return { active, status, stage, level, sendQuestion: () => finishTurn.current?.(), start, stop };
}
