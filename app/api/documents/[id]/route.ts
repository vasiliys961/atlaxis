import { audit } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";
import { sourceDocumentText } from "@/lib/source-document";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await withOwner(ownerId(), async (state) => {
      const document = state.documents.find((item) => item.id === params.id);
      if (!document) return null;
      audit(state, "view", document.id);
      return {
        id: document.id,
        fileName: document.fileName,
        status: document.status,
        statusLabel: document.statusLabel,
        note: document.note,
        studyDate: document.studyDate,
        anonymizedText: document.anonymizedText,
        sourceText: document.status === "ready" ? sourceDocumentText(document) : "",
        facts: state.facts.filter((fact) => fact.documentId === document.id),
      };
    });
    if (!body) return Response.json({ error: "Не найдено." }, { status: 404 });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Не удалось открыть документ." }, { status: 400 });
  }
}
