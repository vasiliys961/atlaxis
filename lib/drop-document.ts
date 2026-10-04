import { buildReport } from "./report";
import type { OwnerState } from "./types";

export function dropDocument(state: OwnerState, documentId: string): boolean {
  if (!state.documents.some((item) => item.id === documentId)) return false;
  state.documents = state.documents.filter((item) => item.id !== documentId);
  state.facts = state.facts.filter((item) => item.documentId !== documentId);
  state.medications = state.medications.filter((item) => item.documentId !== documentId);
  state.issues = state.issues.filter((item) => item.documentId !== documentId);
  state.jobs = state.jobs.filter((item) => item.documentId !== documentId);
  state.report = buildReport(state);
  return true;
}
