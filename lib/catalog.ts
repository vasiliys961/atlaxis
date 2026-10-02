export type AxisKind = "labs" | "medications" | "consistency" | "imaging";

export type ClusterDefinition = {
  id: string;
  title: string;
};

export type AxisDefinition = {
  id: string;
  clusterId: string | null;
  title: string;
  concepts: string[];
  required: string[];
  gap: string;
  kind: AxisKind;
};

export const CLUSTERS: ClusterDefinition[] = [
  { id: "cardiovascular", title: "Сердце и сосуды" },
  { id: "metabolic", title: "Обмен" },
  { id: "renal", title: "Почки" },
  { id: "hepatic", title: "Печень" },
  { id: "hematology", title: "Кровь" },
];

export const AXES: AxisDefinition[] = [
  { id: "blood_pressure", clusterId: "cardiovascular", title: "Сердце и давление", concepts: ["BP_SYS", "BP_DIA"], required: ["BP_SYS"], gap: "В загруженных документах нет давления.", kind: "labs" },
  { id: "lipid_profile", clusterId: "metabolic", title: "Липиды", concepts: ["LDL_C", "HDL_C", "TG", "TC"], required: ["LDL_C"], gap: "В загруженных документах нет липидов.", kind: "labs" },
  { id: "glucose", clusterId: "metabolic", title: "Глюкоза", concepts: ["GLU", "HBA1C"], required: ["GLU"], gap: "В загруженных документах нет глюкозы и гликированного гемоглобина.", kind: "labs" },
  { id: "renal_function", clusterId: "renal", title: "Почки", concepts: ["CREAT", "UREA", "EGFR"], required: ["CREAT"], gap: "В загруженных документах нет креатинина, мочевины и рСКФ.", kind: "labs" },
  { id: "liver_enzymes", clusterId: "hepatic", title: "Печень", concepts: ["ALT", "AST", "GGT", "BILI"], required: ["ALT"], gap: "В загруженных документах нет печёночных показателей.", kind: "labs" },
  { id: "blood_count", clusterId: "hematology", title: "Кровь", concepts: ["HGB", "WBC", "PLT", "RBC"], required: ["HGB"], gap: "В загруженных документах нет показателей крови.", kind: "labs" },
  { id: "medications_as_written", clusterId: "cardiovascular", title: "Препараты в тексте", concepts: [], required: [], gap: "", kind: "medications" },
  { id: "document_consistency", clusterId: null, title: "Сходимость документов", concepts: [], required: [], gap: "", kind: "consistency" },
  { id: "imaging", clusterId: null, title: "Снимки", concepts: [], required: [], gap: "", kind: "imaging" },
];

export type AxisStatus = "sufficient_data" | "partial_data" | "insufficient_data";

export function describeAxes(input: {
  facts: { concept: string }[];
  medications: unknown[];
  documents: { status: string }[];
  issues: unknown[];
}): { id: string; title: string; clusterId: string | null; status: AxisStatus }[] {
  const concepts = new Set(input.facts.map((fact) => fact.concept));
  return AXES.map((axis) => {
    if (axis.kind === "medications") {
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status: input.medications.length > 0 ? "sufficient_data" : "insufficient_data" };
    }
    if (axis.kind === "consistency") {
      const readable = input.documents.some((document) => document.status === "ready");
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status: readable ? "sufficient_data" : "insufficient_data" };
    }
    if (axis.kind === "imaging") {
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status: "insufficient_data" };
    }
    const present = axis.concepts.filter((concept) => concepts.has(concept));
    const requiredMet = axis.required.every((concept) => concepts.has(concept));
    const status: AxisStatus = present.length === 0 ? "insufficient_data" : requiredMet ? "sufficient_data" : "partial_data";
    return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status };
  });
}
