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
