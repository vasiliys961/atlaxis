import { chatReply } from "@/lib/explain";
import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const messages = await withOwner(ownerId(), async (state) => state.chat);
  return Response.json({ messages });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : "";
    const messages = await withOwner(ownerId(), (state) => chatReply(state, message));
    return Response.json({ messages });
  } catch {
    return Response.json({ error: "Не удалось ответить по анализам." }, { status: 400 });
  }
}
