import { ownerId } from "@/lib/owner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const recent = new Map<string, number>();
export async function POST(request: Request) {
  if (request.headers.get("origin") !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) return Response.json({}, { status: 403 });
  const owner = ownerId();
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Не настроен голос OpenAI." }, { status: 503 });
  let text: string;
  try {
    const raw = await request.text(); if (raw.length > 8000) throw new Error();
    const body = JSON.parse(raw); text = body.text;
    if (typeof text !== "string" || !text.trim() || text.length > 600) throw new Error();
  } catch { return Response.json({ error: "Озвучивание принимает от 1 до 600 символов." }, { status: 400 }); }
  if (Date.now() - (recent.get(owner) ?? 0) < 10000) return Response.json({ error: "Подождите 10 секунд перед повторным озвучиванием." }, { status: 429 });
  recent.set(owner, Date.now());
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "onyx", speed: 1.0, input: text, response_format: "pcm", instructions: "Говори на естественном русском языке устойчивым мужским голосом. Тёплая, заинтересованная разговорная подача: как внимательный собеседник, который спокойно объясняет понятную ему тему. Немного меняй интонацию по смыслу, выделяй ключевые слова и делай короткие естественные паузы между мыслями. Обычный разговорный темп, без монотонности и дикторской торжественности. Без дрожания, вибрато, шёпота, придыхания и преувеличенных эмоций. Не растягивай окончания слов. Чётко произноси числа и единицы измерения. Название ATLAXIS произноси Атлаксис. Читай данный текст точно, ничего не добавляй." }), signal: AbortSignal.any([request.signal, AbortSignal.timeout(40000)]),
    });
    if (!response.ok) return Response.json({ error: `Не удалось синтезировать речь (HTTP ${response.status}).` }, { status: 502 });
    const audio = await response.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > 5000000 || audio.byteLength % 2) throw new Error();
    return new Response(audio, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Не удалось подготовить речь. Попробуйте ещё раз." }, { status: 502 }); }
}
