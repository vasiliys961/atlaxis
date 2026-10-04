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

export type PreparedJob =
  | { kind: "idle" }
  | { kind: "settled" }
  | { kind: "ready"; documentId: string; origin: "phone" | "computer"; bytes: Buffer };

export async function prepareJob(state: OwnerState, dir: string): Promise<PreparedJob> {
  const job = claim(state);
  if (!job?.documentId) return { kind: "idle" };
  job.status = "running";
  job.at = new Date().toISOString();
  const document = state.documents.find((item) => item.id === job.documentId);
  if (!document || document.status !== "queued") {
    job.status = "done";
    return { kind: "settled" };
  }
  document.statusLabel = "Разбирается";
  document.note = "Файл читается.";
  const local = path.join(dir, `${document.id}.bin`);
  const bytes = await readFile(local).catch(() => readBinary(`${path.basename(dir)}/${document.id}.bin`));
  if (!bytes) {
    document.status = "failed";
    document.statusLabel = "Не удалось разобрать";
    document.note = "Файл принят, но оригинал в хранилище не найден.";
    job.status = "failed";
    state.report = null;
    return { kind: "settled" };
  }
  return { kind: "ready", documentId: document.id, origin: job.origin ?? "computer", bytes };
}

export async function completeJob(
  state: OwnerState,
  job: { documentId: string; origin: "phone" | "computer"; bytes: Buffer },
): Promise<void> {
  const record = state.jobs.find((item) => item.documentId === job.documentId && item.status === "running");
  const document = state.documents.find((item) => item.id === job.documentId);
  if (!record || !document) return;
  if (document.status !== "queued") {
    record.status = "done";
    return;
  }
  await settleDocument(state, document, job.bytes, job.origin);
  record.status = document.status === "queued" ? "failed" : "done";
}

export async function runNextJob(state: OwnerState, dir: string): Promise<boolean> {
  const step = await prepareJob(state, dir);
  if (step.kind === "idle") return false;
  if (step.kind === "ready") await completeJob(state, step);
  return true;
}

export async function drainOwner(ownerId: string): Promise<void> {
  if (draining.has(ownerId)) return;
  draining.add(ownerId);
  try {
    for (let step = 0; step < 8; step += 1) {
      const prepared = await withOwner(ownerId, async (state, dir) => prepareJob(state, dir));
      if (prepared.kind === "idle") break;
      if (prepared.kind === "settled") continue;
      await withOwner(ownerId, async (state) => {
        await completeJob(state, prepared);
      });
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
