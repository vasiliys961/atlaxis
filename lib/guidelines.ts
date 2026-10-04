import { sonarFoundRussian } from "./guidelines-search";

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
    supersededBy: "aha-acc-dyslipidemia-2026",
  },
  {
    id: "aha-acc-dyslipidemia-2026",
    organization: "ACC/AHA",
    title: "Guideline on the management of dyslipidemia",
    version: "2026",
    publicationDate: "2026",
    region: "US",
    url: "https://www.jacc.org/doi/10.1016/j.jacc.2025.11.016",
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
  origin: "selected" | "offered";
  place: string;
  url?: string;
  population?: string;
  targetValue?: string;
  targetUnit?: string;
};

function toEntry(item: Guideline, origin: CatalogEntry["origin"]): CatalogEntry {
  const place = item.region === "EU" ? "Европа" : item.region === "US" ? "США" : "Россия";
  return {
    organization: item.organization,
    title: item.title,
    version: item.version,
    publicationDate: item.publicationDate,
    standing: item.supersededBy ? "kept" : "current",
    origin,
    place,
    ...(item.url ? { url: item.url } : {}),
    ...(item.targets?.[0]
      ? {
          population: item.targets[0].population,
          targetValue: String(item.targets[0].value),
          targetUnit: item.targets[0].unit,
        }
      : {}),
  };
}

export function targetMark(item: CatalogEntry): string {
  if (item.targetValue && item.targetUnit && item.population) {
    return `Пометка: цель источника для группы «${item.population}», не личная цель — ${item.targetValue} ${item.targetUnit}.`;
  }
  if (item.standing === "current") return "В этой записи числовой цели нет.";
  return "";
}

export function catalogEntries(region: Guideline["region"]): CatalogEntry[] {
  const own = currentGuidelines(region);
  if (own.length > 0) return own.map((item) => toEntry(item, "selected"));
  return [...currentGuidelines("EU"), ...currentGuidelines("US")].map((item) => toEntry(item, "offered"));
}

export function guidelineSentence(region: Guideline["region"], search?: string | null): string {
  const regionName = region === "RU" ? "России" : region === "EU" ? "Европы" : "США";
  const all = guidelinesFor(region);
  const current = currentGuidelines(region);
  if (all.length === 0) {
    if (search && sonarFoundRussian(search)) {
      return "Поиск нашёл опубликованную российскую рекомендацию. Цитата ниже: это поиск, не запись каталога. Рядом остаются европейские и американские записи. Пометка: они не заменяют российскую рекомендацию, а число цели — не личная цель.";
    }
    if (search) {
      return "Поиск не нашёл российскую рекомендацию. Ниже есть записи США и Европы. Пометка: они не заменяют российскую рекомендацию, а число цели — не личная цель.";
    }
    return "Российской записи в каталоге нет. Разбор ищет опубликованные рекомендации по уже загруженным анализам. Если не найдёт, ниже остаются европейские и американские записи. Пометка: они не заменяют российскую рекомендацию, а число цели — не личная цель.";
  }
  const used = current.map((item) => `${item.organization}, ${item.title}, версия ${item.version}`).join("; ");
  const olderNote = all.some((item) => item.supersededBy)
    ? " Более ранняя редакция не показывается и актуальной не считается."
    : "";
  return `Разбор называет только последнюю редакцию для ${regionName}: ${used}.${olderNote} Пометка: число цели, если оно есть в записи, относится к группе из источника и не является личной целью.`;
}
