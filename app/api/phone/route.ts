import { audit } from "@/lib/audit";
import { stageFile } from "@/lib/ingest";
import { ownerId } from "@/lib/owner";
import { createPhoneLink, ownerForCode } from "@/lib/phone-link";
import { continueAfterResponse, drainOwner, enqueueDocument } from "@/lib/queue";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const owner = await ownerForCode(code);
  if (!owner) return Response.json({ ok: false }, { status: 404 });
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const link = await createPhoneLink(ownerId());
      return Response.json(link);
    } catch {
      return Response.json({ error: "Не удалось открыть отправку с телефона." }, { status: 400 });
    }
  }

  try {
    const form = await request.formData();
    const code = String(form.get("code") ?? "");
    const owner = await ownerForCode(code);
    if (!owner) return Response.json({ error: "Ссылка устарела. Откройте новую на компьютере." }, { status: 404 });
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (files.length === 0) return Response.json({ error: "Файл не выбран." }, { status: 400 });
    const documents = await withOwner(owner, async (state, dir) => {
      const saved = [];
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        const document = await stageFile(state, dir, file.name || "photo.jpg", bytes);
        audit(state, "upload", document.id);
        if (document.status === "queued") enqueueDocument(state, document.id, document.fileName, "phone");
        saved.push({ fileName: document.fileName, statusLabel: document.statusLabel, note: document.note });
      }
      return saved;
    });
    continueAfterResponse(drainOwner(owner));
    return Response.json({ documents });
  } catch {
    return Response.json({ error: "Не удалось принять файл со смартфона." }, { status: 400 });
  }
}
