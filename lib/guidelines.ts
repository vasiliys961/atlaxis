export type Guideline = {
  id: string;
  organization: string;
  title: string;
  version: string;
  publicationDate: string;
  region: "RU" | "EU" | "US";
  url?: string;
  supersededBy?: string;
  targets?: { concept: string; population: string; value: number; unit: string }[];
};

export const GUIDELINES: Guideline[] = [
  {
    id: "esc-eas-dyslipidaemia-2019",
    organization: "ESC/EAS",
    title: "Guidelines for the management of dyslipidaemias",
    version: "2019",
    publicationDate: "2019-08-31",
    region: "EU",
    url: "https://doi.org/10.1093/eurheartj/ehz455",
    supersededBy: "esc-eas-dyslipidaemia-2025",
  },
  {
    id: "esc-eas-dyslipidaemia-2025",
    organization: "ESC/EAS",
    title: "Focused update of the guidelines for the management of dyslipidaemias",
    version: "2025",
    publicationDate: "2025",
    region: "EU",
    targets: [{ concept: "LDL_C", population: "very-high cardiovascular risk", value: 1.8, unit: "ммоль/л" }],
  },
  {
    id: "aha-acc-cholesterol-2018",
    organization: "AHA/ACC",
    title: "Guideline on the management of blood cholesterol",
    version: "2018",
    publicationDate: "2018-11-10",
    region: "US",
  },
];

export function guidelinesFor(region: Guideline["region"]): Guideline[] {
  return GUIDELINES.filter((item) => item.region === region);
}

export function currentGuidelines(region: Guideline["region"]): Guideline[] {
  return guidelinesFor(region).filter((item) => !item.supersededBy);
}

export type CatalogEntry = {
  organization: string;
  title: string;
  version: string;
  publicationDate: string;
  standing: "current" | "kept";
  url?: string;
  population?: string;
};

export function catalogEntries(region: Guideline["region"]): CatalogEntry[] {
  return guidelinesFor(region).map((item) => ({
    organization: item.organization,
    title: item.title,
    version: item.version,
    publicationDate: item.publicationDate,
    standing: item.supersededBy ? "kept" : "current",
    ...(item.url ? { url: item.url } : {}),
    ...(item.targets?.[0]?.population ? { population: item.targets[0].population } : {}),
  }));
}

export function guidelineSentence(region: Guideline["region"]): string {
  const regionName = region === "RU" ? "России" : region === "EU" ? "Европы" : "США";
  const all = guidelinesFor(region);
  const current = currentGuidelines(region);
  if (all.length === 0) {
    return `Для ${regionName} в каталоге этой поставки нет записи, которую можно процитировать. Целевой показатель в выбранном источнике не сопоставлен.`;
  }
  const used = current.map((item) => `${item.organization}, ${item.title}, версия ${item.version}`).join("; ");
  const older = all.filter((item) => item.supersededBy);
  const olderNote = older.length > 0
    ? ` Более ранняя версия ${older.map((item) => item.version).join(", ")} в каталоге сохранена и актуальной не считается.`
    : "";
  return `Разбор смотрит каталог для ${regionName}: ${used}.${olderNote} Целевой показатель в выбранном источнике не сопоставлен: в документах не указана группа, для которой источник задаёт число.`;
}
