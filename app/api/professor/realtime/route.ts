import { NextRequest } from "next/server";
import { ownerId } from "@/lib/owner";
import { openaiSdpCall } from "@/lib/openai-sdp-call";
import { professorRealtimeSession, validSdp } from "@/lib/professor-realtime-session";

export const runtime = "nodejs";
export const maxDuration = 60;
const recent = new Map<string, number>();
const noStore = { "Cache-Control": "no-store" };
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

export async function GET() {
  return Response.json({ enabled: process.env.PROFESSOR_REALTIME_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY) }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  if (process.env.PROFESSOR_REALTIME_ENABLED !== "true" || !process.env.OPENAI_API_KEY)
    return reply("Живой разговор пока не включён на сервере. Письменный чат доступен.", 503);
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return reply("Откройте разговор из приложения Атлаксис.", 403);
  const id = ownerId();
  // Require the pre-existing owner session; don't mint paid sessions on a bare POST.
  if (request.cookies.get("atlaxis_owner")?.value !== id) return reply("Обновите страницу перед подключением.", 403);
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > 60_000) recent.delete(key);
  if (recent.has(id)) return reply("Подождите минуту перед повторным подключением.", 429);
  if (Number(request.headers.get("content-length") ?? 0) > 110_000) return reply("Слишком большой запрос.", 413);
  let body: { sdp?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 110_000) return reply("Слишком большой запрос.", 413);
    body = JSON.parse(raw);
  } catch { return reply("Некорректный запрос подключения.", 400); }
  if (!body || !validSdp(body.sdp)) return reply("Некорректный запрос подключения.", 400);
  recent.set(id, now);
  const form = new FormData();
  form.set("sdp", body.sdp);
  form.set("session", JSON.stringify(professorRealtimeSession()));
  try {
    const upstream = await openaiSdpCall(form, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
    if (upstream.status < 200 || upstream.status >= 300 || !validSdp(upstream.body))
      return reply("Не удалось подключить голосовой сервис. Проверьте доступ к Realtime API.", 502);
    return Response.json({ answerSdp: upstream.body }, { headers: noStore });
  } catch { return reply("Не удалось установить голосовое соединение. Попробуйте позже.", 502); }
}
