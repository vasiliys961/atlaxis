import { audit, finishJob } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { publishReport } from "@/lib/publish";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await withOwner(ownerId(), async (state) => {
      const document = state.documents.find((item) => item.id === params.id);
      if (!document) return null;
      finishJob(state, "PROCESS_DOCUMENT");
      audit(state, "process", document.id);
      await publishReport(state);
      return { id: document.id, status: document.status, statusLabel: document.statusLabel };
    });
    if (!body) return Response.json({ error: "Не найдено." }, { status: 404 });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Не удалось обработать документ." }, { status: 400 });
  }
}
