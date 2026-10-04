import { ownerId } from "@/lib/owner";
import { viewPatient } from "@/lib/patient-view";
import { buildTimeline } from "@/lib/report";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return viewPatient(ownerId(), params.id, (state) => ({
    events: buildTimeline(state),
  }));
}
