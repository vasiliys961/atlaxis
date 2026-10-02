import { ownerId } from "@/lib/owner";
import { viewPatient } from "@/lib/patient-view";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return viewPatient(ownerId(), params.id, (state) => ({ issues: state.issues }));
}
