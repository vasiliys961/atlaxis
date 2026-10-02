import { ownerId } from "@/lib/owner";
import { viewPatient } from "@/lib/patient-view";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return viewPatient(ownerId(), params.id, (state) => ({
    events: [...state.facts].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).map((fact) => ({
      date: fact.date,
      label: fact.label,
      value: fact.valueText,
      unit: fact.unit,
      documentId: fact.documentId,
    })),
  }));
}
