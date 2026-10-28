import { audit } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { continueAfterResponse, drainOwner, enqueueDocument } from "@/lib/queue";
import { withOwner } from "@/lib/store";
import { PIPELINE_VERSION } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await withOwner(ownerId(), async (state) => {
      const document = state.documents.find((item) => item.id === params.id);
      if (!document) return null;
      if (document.status === "anonymization_unconfirmed") {
        document.status = "queued";
        document.statusLabel = "Проверяется";
        document.note = "Повторное чтение поставлено в очередь.";
        document.pipelineVersion = PIPELINE_VERSION;
        document.anonymizedText = "";
        document.studyDate = null;
        delete document.visualAnalysis;
        state.report = null;
      }
      if (document.status === "queued") enqueueDocument(state, document.id, document.fileName);
      audit(state, "process", document.id);
      return { id: document.id, status: document.status, statusLabel: document.statusLabel };
    });
    if (!body) return Response.json({ error: "Не найдено." }, { status: 404 });
    continueAfterResponse(drainOwner(ownerId()));
    return Response.json(body);
  } catch {
    return Response.json({ error: "Не удалось обработать документ." }, { status: 400 });
  }
}
