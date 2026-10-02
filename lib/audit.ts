import { newId } from "./parse";
import type { OwnerState } from "./types";

export function audit(state: OwnerState, action: OwnerState["audit"][number]["action"], target?: string): void {
  state.audit.push({ at: new Date().toISOString(), action, target });
}

export function finishJob(state: OwnerState, name: string): void {
  state.jobs.push({ id: newId(), name, status: "done", at: new Date().toISOString() });
}
