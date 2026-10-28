import { ownerId } from "@/lib/owner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const worker = "http://127.0.0.1:8767";
function headers() {
  return { "content-type": "application/json", "X-Avatar-Token": process.env.ATLAXIS_LOCAL_AVATAR_TOKEN ?? "", "X-Avatar-Owner": ownerId() };
}
export async function POST(request: Request) {
  if (process.env.ATLAXIS_LOCAL_AVATAR_RENDER !== "true") return Response.json({ error: "Генерация видео на Mac приостановлена. Можно слушать готовый локальный голос и тестировать OpenAI Realtime." }, { status: 409 });
  const origin = request.headers.get("origin");
  if (origin && origin !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 240) return Response.json({ error: "Для пробы нужен текст от 1 до 240 символов." }, { status: 400 });
    const response = await fetch(`${worker}/jobs`, { method: "POST", headers: headers(), body: JSON.stringify({ text: body.text }), cache: "no-store" });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ error: "Локальный генератор не запущен." }, { status: 503 }); }
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), id = url.searchParams.get("job");
    if (!id) {
      const response = await fetch(`${worker}/health`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(3000) });
      return Response.json(await response.json(), { status: response.status });
    }
    if (!/^[a-f0-9]{32}$/.test(id)) return Response.json({ error: "Неверная задача." }, { status: 400 });
    const video = url.searchParams.get("video") === "1";
    const response = await fetch(`${worker}/jobs/${id}${video ? "/video" : ""}`, { headers: headers(), cache: "no-store" });
    if (video && response.ok) return new Response(response.body, { headers: { "content-type": "video/mp4", "cache-control": "no-store" } });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ error: "Локальный генератор недоступен." }, { status: 503 }); }
}
