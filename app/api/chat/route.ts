import { chatReply } from "@/lib/explain";
import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const messages = await withOwner(ownerId(), async (state) => state.chat);
  return Response.json({ messages });
}

export async function DELETE() {
  const messages = await withOwner(ownerId(), async (state) => {
    state.chat = [];
    return state.chat;
  });
  return Response.json({ messages });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: unknown; mode?: unknown; responseStyle?: unknown };
    const message = typeof body.message === "string" ? body.message : "";
    if (body.mode !== undefined && body.mode !== "analysis" && body.mode !== "general") return Response.json({ error: "Неизвестный режим чата." }, { status: 400 });
    if (body.responseStyle !== undefined && body.responseStyle !== "written" && body.responseStyle !== "dialogue") return Response.json({ error: "Неизвестный формат ответа." }, { status: 400 });
    const id = ownerId();
    const snapshot = await withOwner(id, async (state) => structuredClone(state));
    const messages = await chatReply(snapshot, message, body.mode === "general" ? "general" : "analysis", body.responseStyle === "dialogue" ? "dialogue" : "written");
    await withOwner(id, async (state) => {
      state.chat = messages;
    });
    return Response.json({ messages });
  } catch {
    return Response.json({ error: "Не удалось ответить по анализам." }, { status: 400 });
  }
}
