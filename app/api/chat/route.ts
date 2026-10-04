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
    const body = await request.json() as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : "";
    const id = ownerId();
    const snapshot = await withOwner(id, async (state) => structuredClone(state));
    const messages = await chatReply(snapshot, message);
    await withOwner(id, async (state) => {
      state.chat = messages;
    });
    return Response.json({ messages });
  } catch {
    return Response.json({ error: "Не удалось ответить по анализам." }, { status: 400 });
  }
}
