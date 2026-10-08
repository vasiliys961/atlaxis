import { audit } from "@/lib/audit";
import { ownerId } from "@/lib/owner";
import { publishReport } from "@/lib/publish";
import { withOwner } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const report = await withOwner(ownerId(), async (state) => {
      if (state.jobs.some(job => job.status === "queued" || job.status === "running")) throw new Error("documents_pending");
      const next = await publishReport(state, true);
      const stored = state.reports[state.reports.length - 1];
      audit(state, "generate", stored?.id);
      return { ...next, id: stored?.id };
    });
    return Response.json(report);
  } catch {
    return Response.json({ error: "Не удалось собрать разбор." }, { status: 400 });
  }
}
