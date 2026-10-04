import { CLUSTERS, describeAxes } from "./catalog";
import { currentGuidelines } from "./guidelines";
import { owned } from "./guard";
import { publishReport } from "./publish";
import { withOwner } from "./store";
import type { OwnerState } from "./types";

export async function viewPatient(owner: string, patientId: string, pick: (state: OwnerState) => unknown): Promise<Response> {
  const denied = owned(owner, patientId);
  if (denied) return denied;
  try {
    const body = await withOwner(owner, async (state) => {
      await publishReport(state);
      return pick(state);
    });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Не удалось открыть данные." }, { status: 400 });
  }
}

export function clusterView(state: OwnerState) {
  const axes = describeAxes(state);
  return {
    clusters: CLUSTERS.map((cluster) => ({
      id: cluster.id,
      title: cluster.title,
      axes: axes.filter((axis) => axis.clusterId === cluster.id).map(({ id: axisId, title, status }) => ({ id: axisId, title, status })),
    })),
    axes,
  };
}

export function evidenceView(region: OwnerState["region"]) {
  return currentGuidelines(region).map((item) => ({
    id: item.id,
    organization: item.organization,
    title: item.title,
    version: item.version,
    publicationDate: item.publicationDate,
    region: item.region,
    url: item.url ?? null,
    supersededBy: item.supersededBy ?? null,
    targets: item.targets ?? [],
  }));
}
