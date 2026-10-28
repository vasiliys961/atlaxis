import { professorRealtimeSession } from "@/lib/professor-realtime-session";
import { withOwner } from "@/lib/store";
import { createHash } from "crypto";
import { ownerId } from "@/lib/owner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const recent = new Map<string, number>();
export async function GET() {
  return Response.json({ enabled: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1" }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "Добавьте OPENAI_API_KEY в .env.local тестовой копии ATLAXIS." }, { status: 503 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) return Response.json({ error: "Запустите тест со страницы ATLAXIS." }, { status: 403 });
  const owner = ownerId();
  if (Date.now() - (recent.get(owner) ?? 0) < 15000) return Response.json({ error: "Подождите 15 секунд перед новым подключением." }, { status: 429 });
  if (Number(request.headers.get("content-length") || 0) > 100000) return Response.json({ error: "Слишком большой запрос." }, { status: 413 });
  let sdp: string; let kind: "demo" | "professor" = "demo"; let mode: "analysis" | "general" = "general";
  try { const raw = await request.text(); if (raw.length > 100000) throw new Error(); const body = JSON.parse(raw); if (body.kind !== undefined && !["demo", "professor"].includes(body.kind)) throw new Error(); if (body.mode !== undefined && !["general", "analysis"].includes(body.mode)) throw new Error(); kind = body.kind || "demo"; mode = body.mode || "general"; sdp = body.sdp; if (typeof sdp !== "string" || !sdp.startsWith("v=")) throw new Error(); }
  catch { return Response.json({ error: "Некорректный запрос WebRTC." }, { status: 400 }); }
  recent.set(owner, Date.now());
  const demoSession = {
    type: "realtime", model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1", output_modalities: ["audio"], max_output_tokens: 1024,
    instructions: "Ты голосовой демонстрационный помощник ATLAXIS. Говори по-русски, спокойно, не более двух коротких предложений за ответ. ATLAXIS помогает загрузить анализы, выписки и снимки, сопоставить сведения и подготовить вопросы врачу. В приложении есть разделы Документы и Разбор и письменный чат Профессора. Ты цифровой персонаж, не врач. Это отдельный тест OpenAI Realtime: доступа к документам, истории пациента и письменному чату нет. Не выдумывай наличие доступа. При просьбе разобрать личные анализы направь пользователя в письменный чат профессора. Не ставь диагнозы и не назначай лечение. Не обещай функции и результаты, которых не знаешь. Не утверждай, что сейчас управляешь губами видео: синхронизация аватара пока выполняется отдельно.",
    audio: { input: { noise_reduction: { type: "near_field" }, transcription: { model: "gpt-4o-mini-transcribe", language: "ru" }, turn_detection: { type: "server_vad", silence_duration_ms: 650, create_response: true, interrupt_response: true } }, output: { voice: "marin" } },
  };
  const history = kind === "professor" ? await withOwner(owner, async state => state.chat.filter(turn => (turn.mode ?? "analysis") === mode).slice(-8).map(turn => `${turn.role}: ${turn.text}`).join("\n").slice(-7000)) : "";
  const session = kind === "professor" ? professorRealtimeSession(mode, history) : demoSession;
  const form = new FormData(); form.set("sdp", sdp); form.set("session", JSON.stringify(session));
  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${key}`, "OpenAI-Safety-Identifier": createHash("sha256").update(owner).digest("hex") }, body: form, signal: AbortSignal.timeout(30000) });
    if (!upstream.ok) return Response.json({ error: `OpenAI не создал сессию (HTTP ${upstream.status}). Проверьте ключ, доступ к модели и API-баланс.` }, { status: 502 });
    const answerSdp = await upstream.text();
    if (!answerSdp.startsWith("v=")) throw new Error();
    return Response.json({ answerSdp }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Не удалось установить соединение с OpenAI." }, { status: 502 }); }
}
