import { ownerId } from "@/lib/owner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const recent = new Map<string, number>();
export async function POST(request: Request) {
  if (request.headers.get("origin") !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) return Response.json({}, { status: 403 });
  const owner = ownerId();
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Не настроено распознавание речи." }, { status: 503 });
  try {
    if (Number(request.headers.get("content-length") || 0) > 3000000) return Response.json({ error: "Запись слишком длинная." }, { status: 413 });
    const form = await request.formData(), file = form.get("audio");
    if (!(file instanceof File) || file.size < 100 || file.size > 2500000) return Response.json({ error: "Некорректная запись вопроса." }, { status: 400 });
    if (Date.now() - (recent.get(owner) ?? 0) < 3000) return Response.json({ error: "Подождите пару секунд перед новым вопросом." }, { status: 429 });
    recent.set(owner, Date.now());
    const data = new FormData(); data.set("file", file, file.type.includes("wav") ? "question.wav" : file.type.includes("mp4") ? "question.mp4" : "question.webm"); data.set("model", "gpt-4o-mini-transcribe"); data.set("language", "ru");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: data, signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) { const detail = await response.json().catch(() => ({})); return Response.json({ error: `Не удалось распознать вопрос (HTTP ${response.status}, ${detail.error?.code || detail.error?.type || "unknown"}).` }, { status: 502 }); }
    const result = await response.json(); return Response.json({ text: typeof result.text === "string" ? result.text.trim().slice(0,1500) : "" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Ошибка распознавания речи." }, { status: 502 }); }
}
