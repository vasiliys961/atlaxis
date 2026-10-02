import { evidenceView } from "@/lib/patient-view";
import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";
import { REGIONS, type Region } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get("region");
    const region = await withOwner(ownerId(), async (state) => {
      return requested && REGIONS.includes(requested as Region) ? (requested as Region) : state.region;
    });
    return Response.json({ guidelines: evidenceView(region) });
  } catch {
    return Response.json({ error: "Не удалось открыть каталог." }, { status: 400 });
  }
}
