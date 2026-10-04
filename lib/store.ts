import { mkdir } from "fs/promises";
import path from "path";
import { dataRoot } from "./data-root";
import { readText, removePrefix, writeText } from "./files";
import { dropPhoneLinks } from "./phone-link";
import { emptyState, type OwnerState } from "./types";

const locks = new Map<string, Promise<unknown>>();

function root(ownerId: string): string {
  return path.join(dataRoot(), ownerId);
}

export async function withOwner<T>(ownerId: string, task: (state: OwnerState, dir: string) => Promise<T>): Promise<T> {
  const previous = locks.get(ownerId) ?? Promise.resolve();
  const run = previous.then(async () => {
    const dir = root(ownerId);
    await mkdir(dir, { recursive: true });
    const stateKey = `${ownerId}/state.json`;
    let state = emptyState();
    try {
      const raw = await readText(stateKey);
      if (!raw) throw new Error("empty");
      const saved = JSON.parse(raw) as Partial<OwnerState>;
      state = { ...emptyState(), ...saved };
      state.documents ??= [];
      state.facts ??= [];
      state.medications ??= [];
      state.issues ??= [];
      state.reports ??= [];
      state.reviews ??= [];
      state.jobs ??= [];
      state.audit ??= [];
      state.chat ??= [];
    } catch {
      state = emptyState();
    }
    const result = await task(state, dir);
    await writeText(stateKey, JSON.stringify(state));
    return result;
  });
  locks.set(ownerId, run.then(() => undefined, () => undefined));
  return run;
}

export async function deleteOwner(ownerId: string): Promise<void> {
  await withOwner(ownerId, async (state) => {
    state.documents = [];
    state.facts = [];
    state.medications = [];
    state.issues = [];
    state.report = null;
    state.reports = [];
    state.reviews = [];
    state.jobs = [];
    state.audit = [];
    state.chat = [];
  });
  await removePrefix(`${ownerId}/`);
  await dropPhoneLinks(ownerId);
}
