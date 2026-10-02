import { ownerId } from "@/lib/owner";
import { clusterView, viewPatient } from "@/lib/patient-view";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return viewPatient(ownerId(), params.id, (state) => clusterView(state));
}
