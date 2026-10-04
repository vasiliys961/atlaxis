import { readFile } from "fs/promises";
import path from "path";
import { waitUntil } from "@vercel/functions";
import { readBinary } from "./files";
import { settleDocument } from "./ingest";
import { newId } from "./parse";
import { publishReport, reportNeedsRefresh } from "./publish";
import { buildReport } from "./report";
import { withOwner } from "./store";
import type { JobRecord, OwnerState } from "./types";

const STALE_MS = 2 * 60 * 1000;
const draining = new Set<string>();

export function reportPending(state: OwnerState): boolean {
  if (state.jobs.some((job) => job.status === "queued" || job.status === "running")) return true;
  return state.report?.inputHash !== buildReport(state).inputHash;
}

export function enqueueDocument(state: OwnerState, documentId: string, name: string, origin: "phone" | "computer" = "computer"): void {
  const open = state.jobs.some((job) => job.documentId === documentId && (job.status === "queued" || job.status === "running"));
  if (open) return;
  state.jobs.push({
    id: newId(),
    name,
    status: "queued",
    at: new Date().toISOString(),
    documentId,
    origin,
  });
  const done = state.jobs.filter((job) => job.status === "done" || job.status === "failed");
  if (state.jobs.length > 40 && done.length > 0) {
    const drop = new Set(done.slice(0, state.jobs.length - 40).map((job) => job.id));
    state.jobs = state.jobs.filter((job) => !drop.has(job.id));
  }
}

function claim(state: OwnerState): JobRecord | undefined {
  const now = Date.now();
  return state.jobs.find((job) => {
    if (!job.documentId) return false;
    if (job.status === "queued") return true;
    return job.status === "running" && now - Date.parse(job.at) > STALE_MS;
  });
}

export async function runNextJob(state: OwnerState, dir: string): Promise<boolean> {
  const job = claim(state);
  if (!job?.documentId) return false;
  job.status = "running";
  job.at = new Date().toISOString();
  const document = state.documents.find((item) => item.id === job.documentId);
  if (!document || document.status !== "queued") {
    job.status = "done";
    return true;
  }
  const local = path.join(dir, `${document.id}.bin`);
  const bytes = await readFile(local).catch(() => readBinary(`${path.basename(dir)}/${document.id}.bin`));
  if (!bytes) {
    document.status = "failed";
    document.statusLabel = "Не удалось разобрать";
    document.note = "Файл принят, но оригинал в хранилище не найден.";
    job.status = "failed";
    state.report = null;
    return true;
  }
  await settleDocument(state, document, bytes, job.origin ?? "computer");
  job.status = document.status === "queued" ? "failed" : "done";
  return true;
}

export async function drainOwner(ownerId: string): Promise<void> {
  if (draining.has(ownerId)) return;
  draining.add(ownerId);
  try {
    for (let step = 0; step < 8; step += 1) {
      const more = await withOwner(ownerId, async (state, dir) => runNextJob(state, dir));
      if (!more) break;
    }
    await withOwner(ownerId, async (state) => {
      if (state.jobs.some((job) => job.status === "queued" || job.status === "running")) return;
      if (!reportNeedsRefresh(state)) return;
      await publishReport(state);
    });
  } finally {
    draining.delete(ownerId);
  }
}

export function continueAfterResponse(work: Promise<unknown>): void {
  const safe = work.catch(() => undefined);
  if (process.env.VERCEL) {
    waitUntil(safe);
    return;
  }
  void safe;
}
