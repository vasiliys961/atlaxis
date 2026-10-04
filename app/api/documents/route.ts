import { audit } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { stageFile } from "@/lib/ingest";
import { catalogEntries, guidelineSentence } from "@/lib/guidelines";
import { buildRelationships, buildTimeline } from "@/lib/report";
import { listedDocuments, reportNeedsRefresh } from "@/lib/publish";
import { continueAfterResponse, drainOwner, enqueueDocument, reportPending } from "@/lib/queue";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const id = ownerId();
    const payload = await withOwner(id, async (state) => ({
      region: state.region,
      documents: listedDocuments(state),
      report: state.report
        ? {
            ...state.report,
            catalog: catalogEntries(state.region),
            guidelineNote: guidelineSentence(state.region, state.report.guidelineSearch),
            timeline: state.report.status === "blocked" ? [] : buildTimeline(state),
            relationships: state.report.status === "blocked" ? [] : buildRelationships(state),
          }
        : null,
      pending: reportPending(state),
      refreshing: reportNeedsRefresh(state),
    }));
    if (payload.pending || payload.refreshing) continueAfterResponse(drainOwner(id));
    return Response.json(payload);
  } catch {
    return Response.json({ error: "Не удалось открыть документы." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const id = ownerId();
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (files.length === 0) return Response.json({ error: "Файл не выбран." }, { status: 400 });
    const documents = await withOwner(id, async (state, dir) => {
      const saved = [];
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        const document = await stageFile(state, dir, file.name, bytes);
        audit(state, "upload", document.id);
        if (document.status === "queued") enqueueDocument(state, document.id, document.fileName);
        const { anonymizedText: _text, ...safe } = document;
        saved.push(safe);
      }
      return saved;
    });
    continueAfterResponse(drainOwner(id));
    return Response.json({ documents });
  } catch {
    return Response.json({ error: "Не удалось принять файл." }, { status: 400 });
  }
}
