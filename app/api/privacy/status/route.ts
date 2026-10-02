import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await withOwner(ownerId(), async (state) => ({
      documents: state.documents.length,
      reports: state.reports.length,
      canDelete: state.documents.length > 0,
    }));
    return Response.json(status);
  } catch {
    return Response.json({ error: "Не удалось открыть статус." }, { status: 400 });
  }
}
