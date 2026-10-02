import { readFile } from "fs/promises";
import path from "path";
import { audit, finishJob } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { ingestFile } from "@/lib/ingest";
import { listedDocuments, publishReport } from "@/lib/publish";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const id = ownerId();
    const payload = await withOwner(id, async (state) => {
      const report = await publishReport(state);
      return { region: state.region, documents: listedDocuments(state), report };
    });
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
        const document = await ingestFile(state, dir, file.name, bytes);
        audit(state, "upload", document.id);
        finishJob(state, "PROCESS_DOCUMENT");
        const { anonymizedText: _text, ...safe } = document;
        saved.push(safe);
      }
      return saved;
    });
    return Response.json({ documents });
  } catch {
    return Response.json({ error: "Не удалось принять файл." }, { status: 400 });
  }
}

export async function PUT() {
  try {
    const id = ownerId();
    const documents = await withOwner(id, async (state, dir) => {
      const fixtures = ["blank-2024.txt", "blank-2025.txt", "labs.pdf"];
      const saved = [];
      for (const name of fixtures) {
        const bytes = await readFile(path.join(process.cwd(), "fixtures", name));
        const document = await ingestFile(state, dir, name, bytes);
        audit(state, "upload", document.id);
        finishJob(state, "PROCESS_DOCUMENT");
        const { anonymizedText: _text, ...safe } = document;
        saved.push(safe);
      }
      return saved;
    });
    return Response.json({ documents });
  } catch {
    return Response.json({ error: "Не удалось открыть пример." }, { status: 400 });
  }
}
