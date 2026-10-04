import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { dataRoot } from "./data-root";
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
    const statePath = path.join(dir, "state.json");
    let state = emptyState();
    try {
      const saved = JSON.parse(await readFile(statePath, "utf8")) as Partial<OwnerState>;
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
    await writeFile(statePath, JSON.stringify(state));
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
  });
  await rm(root(ownerId), { recursive: true, force: true });
  await dropPhoneLinks(ownerId);
}
