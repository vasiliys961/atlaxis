import { newId } from "@/lib/parse";
import { ownerId } from "@/lib/owner";
import { reviewSchema } from "@/lib/schemas";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const reviews = await withOwner(ownerId(), async (state) => state.reviews);
    return Response.json({ reviews });
  } catch {
    return Response.json({ error: "Не удалось открыть разборы." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = reviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Форма заполнена не до конца." }, { status: 400 });
    }
    const review = await withOwner(ownerId(), async (state) => {
      const finding = { ...parsed.data, id: newId(), createdAt: new Date().toISOString() };
      state.reviews.push(finding);
      return finding;
    });
    return Response.json(review);
  } catch {
    return Response.json({ error: "Не удалось сохранить разбор." }, { status: 400 });
  }
}
