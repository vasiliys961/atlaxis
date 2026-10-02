import { audit } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { deleteOwner, withOwner } from "@/lib/store";

export const runtime = "nodejs";

export async function POST() {
  try {
    const id = ownerId();
    await withOwner(id, async (state) => {
      audit(state, "delete");
    });
    await deleteOwner(id);
    return Response.json({ deleted: true });
  } catch {
    return Response.json({ error: "Не удалось удалить данные." }, { status: 400 });
  }
}
