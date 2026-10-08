export type AxisKind = "labs" | "medications" | "consistency" | "imaging" | "dates";

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
  quietWhenEmpty?: boolean;
};

// Рабочий каталог этой поставки, не официальный перечень рекомендаций.
// Целей, доз и назначений здесь нет.
export const CLUSTERS: ClusterDefinition[] = [
  { id: "cardiovascular", title: "Сердце и сосуды" },
  { id: "metabolic", title: "Липиды" },
  { id: "glucose", title: "Сахар" },
  { id: "renal", title: "Почки" },
  { id: "hepatic", title: "Печень" },
  { id: "hematology", title: "Кровь" },
  { id: "thyroid", title: "Щитовидная железа" },
  { id: "inflammation", title: "Воспаление" },
  { id: "iron", title: "Железо" },
  { id: "electrolytes", title: "Соли" },
  { id: "urate", title: "Мочевая кислота" },
  { id: "coagulation", title: "Свёртывание" },
  { id: "medications", title: "Препараты в тексте" },
  { id: "documents", title: "Сходимость записей" },
  { id: "imaging", title: "Снимки" },
];

export const AXES: AxisDefinition[] = [
  { id: "blood_pressure", clusterId: "cardiovascular", title: "Давление", concepts: ["BP_SYS", "BP_DIA"], required: ["BP_SYS"], gap: "В загруженных документах нет давления.", kind: "labs" },
  { id: "lipid_profile", clusterId: "metabolic", title: "Липиды", concepts: ["LDL_C", "HDL_C", "TG", "TC"], required: ["LDL_C"], gap: "В загруженных документах нет липидов.", kind: "labs" },
  { id: "glucose", clusterId: "glucose", title: "Глюкоза", concepts: ["GLU", "HBA1C"], required: ["GLU"], gap: "В загруженных документах нет глюкозы и гликированного гемоглобина.", kind: "labs" },
  { id: "renal_function", clusterId: "renal", title: "Почки", concepts: ["CREAT", "UREA", "EGFR"], required: ["CREAT"], gap: "В загруженных документах нет креатинина, мочевины и рСКФ.", kind: "labs" },
  { id: "liver_enzymes", clusterId: "hepatic", title: "Печень", concepts: ["ALT", "AST", "GGT", "BILI"], required: ["ALT"], gap: "В загруженных документах нет печёночных показателей.", kind: "labs" },
  { id: "blood_count", clusterId: "hematology", title: "Кровь", concepts: ["HGB", "WBC", "PLT", "RBC"], required: ["HGB"], gap: "В загруженных документах нет показателей крови.", kind: "labs" },
  { id: "thyroid_function", clusterId: "thyroid", title: "Щитовидная железа", concepts: ["TSH"], required: ["TSH"], gap: "В загруженных документах нет ТТГ.", kind: "labs", quietWhenEmpty: true },
  { id: "inflammation_markers", clusterId: "inflammation", title: "Воспаление", concepts: ["CRP"], required: ["CRP"], gap: "В загруженных документах нет СРБ.", kind: "labs", quietWhenEmpty: true },
  { id: "iron_stores", clusterId: "iron", title: "Железо", concepts: ["FERRITIN"], required: ["FERRITIN"], gap: "В загруженных документах нет ферритина.", kind: "labs", quietWhenEmpty: true },
  { id: "electrolytes", clusterId: "electrolytes", title: "Натрий и калий", concepts: ["NA", "K"], required: ["NA"], gap: "В загруженных документах нет натрия и калия.", kind: "labs", quietWhenEmpty: true },
  { id: "urate", clusterId: "urate", title: "Мочевая кислота", concepts: ["URIC"], required: ["URIC"], gap: "В загруженных документах нет мочевой кислоты.", kind: "labs", quietWhenEmpty: true },
  { id: "coagulation", clusterId: "coagulation", title: "МНО", concepts: ["INR"], required: ["INR"], gap: "В загруженных документах нет МНО.", kind: "labs", quietWhenEmpty: true },
  { id: "pancreas_enzymes", clusterId: "hepatic", title: "Амилаза", concepts: ["AMYLASE"], required: ["AMYLASE"], gap: "В загруженных документах нет амилазы.", kind: "labs", quietWhenEmpty: true },
  { id: "vitamin_d", clusterId: "metabolic", title: "Витамин D", concepts: ["VITD"], required: ["VITD"], gap: "В загруженных документах нет витамина D.", kind: "labs", quietWhenEmpty: true },
  { id: "medications_as_written", clusterId: "medications", title: "Препараты в тексте", concepts: [], required: [], gap: "", kind: "medications" },
  { id: "dose_over_time", clusterId: "medications", title: "Дозы по датам", concepts: [], required: [], gap: "", kind: "medications" },
  { id: "document_consistency", clusterId: "documents", title: "Сходимость документов", concepts: [], required: [], gap: "", kind: "consistency" },
  { id: "study_dates", clusterId: "documents", title: "Даты исследований", concepts: [], required: [], gap: "", kind: "dates" },
  { id: "imaging", clusterId: "imaging", title: "Снимки", concepts: [], required: [], gap: "", kind: "imaging" },
  { id: "imaging_measurements", clusterId: "imaging", title: "Числа со снимка", concepts: [], required: [], gap: "", kind: "imaging" },
];

export type AxisStatus = "sufficient_data" | "partial_data" | "insufficient_data";

export function describeAxes(input: {
  facts: { concept: string; date?: string | null }[];
  medications: { date?: string | null }[];
  documents: { status: string; fileName?: string }[];
  issues: unknown[];
}): { id: string; title: string; clusterId: string | null; status: AxisStatus }[] {
  const concepts = new Set(input.facts.map((fact) => fact.concept));
  return AXES.map((axis) => {
    if (axis.kind === "medications") {
      const status: AxisStatus = input.medications.length === 0 ? "insufficient_data" :
        axis.id === "dose_over_time" && input.medications.some(item => !item.date) ? "partial_data" : "sufficient_data";
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status };
    }
    if (axis.kind === "consistency") {
      const readable = input.documents.some((document) => document.status === "ready");
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status: readable ? "sufficient_data" : "insufficient_data" };
    }
    if (axis.kind === "dates") {
      const dated = input.facts.some((fact) => fact.date);
      const status: AxisStatus = dated ? "sufficient_data" : input.facts.length > 0 ? "partial_data" : "insufficient_data";
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status };
    }
    if (axis.kind === "imaging") {
      const read = input.documents.some((document) => document.status === "ready" && /\.(png|jpe?g|webp)$/i.test(document.fileName ?? ""));
      return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status: read ? "partial_data" : "insufficient_data" };
    }
    const present = axis.concepts.filter((concept) => concepts.has(concept));
    const requiredMet = axis.required.every((concept) => concepts.has(concept));
    const status: AxisStatus = present.length === 0 ? "insufficient_data" : requiredMet ? "sufficient_data" : "partial_data";
    return { id: axis.id, title: axis.title, clusterId: axis.clusterId, status };
  });
}
