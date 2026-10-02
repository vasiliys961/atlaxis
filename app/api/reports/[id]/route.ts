import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const report = await withOwner(ownerId(), async (state) => state.reports.find((item) => item.id === params.id) ?? null);
    if (!report) return Response.json({ error: "Не найдено." }, { status: 404 });
    return Response.json(report);
  } catch {
    return Response.json({ error: "Не удалось открыть разбор." }, { status: 400 });
  }
}
