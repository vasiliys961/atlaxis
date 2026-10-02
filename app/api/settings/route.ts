import { REGIONS, type Region } from "@/lib/types";
import { ownerId } from "@/lib/owner";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { region?: Region };
    if (!body.region || !REGIONS.includes(body.region)) {
      return Response.json({ error: "Такой страны в каталоге нет." }, { status: 400 });
    }
    const id = ownerId();
    await withOwner(id, async (state) => {
      state.region = body.region as Region;
      state.report = null;
    });
    return Response.json({ region: body.region });
  } catch {
    return Response.json({ error: "Не удалось сохранить выбор." }, { status: 400 });
  }
}
