import { ownerId } from "@/lib/owner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessions = new Map<string, string>();
const expires = new Map<string, number>();
const pending = new Map<string, { cancelled: boolean }>();
let creating = false;
const api = async (path: string, body?: object) => {
  const response = await fetch(`https://api.liveavatar.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-API-KEY": process.env.LIVEAVATAR_API_KEY!, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`LiveAvatar: HTTP ${response.status}`);
  const result = await response.json();
  if (![100, 1000].includes(result.code)) throw new Error("LiveAvatar: неожиданный ответ API");
  return result.data ?? {};
};
const stop = async (owner: string, id: string) => {
  await api("sessions/stop", { session_id: id, reason: "USER_CLOSED" });
  if (sessions.get(owner) === id) { sessions.delete(owner); expires.delete(owner); }
};
export async function GET() {
  const credits = process.env.LIVEAVATAR_API_KEY ? await api("users/credits").catch(() => null) : null;
  return Response.json({ enabled: Boolean(process.env.OPENAI_API_KEY), videoAvailable: Boolean(process.env.LIVEAVATAR_API_KEY) && (credits === null || Number(credits.credits_left) > 0), sandbox: process.env.LIVEAVATAR_SANDBOX !== "false", connector: Boolean(process.env.LIVEAVATAR_OPENAI_SECRET_ID) }, { headers: { "Cache-Control": "no-store" } });
}

function allowed(request: Request) {
  return request.headers.get("origin") === `${new URL(request.url).protocol}//${request.headers.get("host")}`;
}
export async function DELETE(request: Request) {
  if (!allowed(request)) return Response.json({}, { status: 403 });
  const owner = ownerId(), id = sessions.get(owner);
  const starting = pending.get(owner); if (starting) starting.cancelled = true;
  try { if (id) await stop(owner, id); return Response.json({ stopped: true }); }
  catch { return Response.json({ error: "Сервис не подтвердил остановку; сеанс ограничен 55 секундами." }, { status: 502 }); }
}
export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({}, { status: 403 });
  if (!process.env.LIVEAVATAR_API_KEY) return Response.json({ error: "Добавьте LIVEAVATAR_API_KEY в .env.local тестовой копии." }, { status: 503 });
  let mode: string;
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error(); mode = raw ? JSON.parse(raw).mode ?? "dialogue" : "dialogue"; if (!["dialogue", "professor"].includes(mode)) throw new Error(); }
  catch { return Response.json({ error: "Неизвестный режим аватара." }, { status: 400 }); }
  const owner = ownerId();
  for (const [key, expiry] of expires) { if (expiry <= Date.now()) { sessions.delete(key); expires.delete(key); } }
  if (creating) return Response.json({ error: "Подключение уже выполняется. Подождите несколько секунд и повторите." }, { status: 409 });
  const ownSession = sessions.get(owner);
  if (sessions.size && !ownSession) return Response.json({ error: "Пробный видеосервис занят другим сеансом. Повторите немного позже." }, { status: 409 });
  creating = true;
  const attempt = { cancelled: false }; pending.set(owner, attempt);
  let id: string | undefined;
  try {
    if (ownSession) await stop(owner, ownSession);
    if (attempt.cancelled) throw new Error("Подключение отменено");
    const secret = process.env.LIVEAVATAR_OPENAI_SECRET_ID;
    if (mode === "dialogue" && (!secret || !process.env.LIVEAVATAR_CONTEXT_ID)) throw new Error("Не настроен коннектор OpenAI Realtime");
    const token = await api("sessions/token", {
      mode: "LITE", is_sandbox: process.env.LIVEAVATAR_SANDBOX !== "false", max_session_duration: 55,
      avatar_id: process.env.LIVEAVATAR_AVATAR_ID || "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a",
      ...(mode === "dialogue" ? { openai_realtime_config: {
        secret_id: secret, context_id: process.env.LIVEAVATAR_CONTEXT_ID,
        voice: "cedar", model: "gpt-realtime", temperature: 0.8,
      } } : {}),
    });
    id = token.session_id; if (!id) throw new Error("Не получен ID сессии");
    sessions.set(owner, id); expires.set(owner, Date.now() + 90000);
    if (attempt.cancelled) throw new Error("Подключение отменено");
    const response = await fetch("https://api.liveavatar.com/v1/sessions/start", { method: "POST", headers: { Authorization: `Bearer ${token.session_token}` }, signal: AbortSignal.timeout(25000) });
    if (!response.ok) {
      if (response.status === 403) {
        const credits = await api("users/credits").catch(() => null);
        if (credits && Number(credits.credits_left) <= 0) throw new Error("Пробные кредиты LiveAvatar закончились. Видео недоступно, голосовой ответ можно прослушать без аватара.");
      }
      throw new Error(`Запуск LiveAvatar: HTTP ${response.status}`);
    }
    const { data } = await response.json();
    if (attempt.cancelled) throw new Error("Подключение отменено");
    if (!data?.livekit_url || !data?.livekit_client_token) throw new Error("Не получены параметры видео");
    if (mode === "professor" && !data.ws_url?.startsWith("wss://")) throw new Error("Не получен защищённый канал озвучивания");
    const sessionId = id;
    setTimeout(() => { void stop(owner, sessionId).catch(() => { if (sessions.get(owner) === sessionId) { sessions.delete(owner); expires.delete(owner); } }); }, 60000).unref();
    return Response.json({ url: data.livekit_url, token: data.livekit_client_token, duration: 55, ...(mode === "professor" ? { wsUrl: data.ws_url } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (id) await stop(owner, id).catch(() => {});
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка LiveAvatar" }, { status: 502 });
  } finally { if (pending.get(owner) === attempt) pending.delete(owner); creating = false; }
}
