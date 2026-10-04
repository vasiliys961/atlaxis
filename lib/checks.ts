import type { OwnerState, ReportBlock } from "./types";

export type QualityCheck = {
  label: string;
  text: string;
};

function count(hit: number, total: number, empty: string): string {
  if (total === 0) return empty;
  return `${hit} из ${total}`;
}

function claims(report: OwnerState["report"]): ReportBlock[] {
  if (!report || report.status === "blocked") return [];
  return [...report.themes, ...report.changes, ...report.conflicts, ...report.relationships].filter((item) => item.body.trim());
}

export function qualityChecks(state: OwnerState): QualityCheck[] {
  const facts = state.facts;
  const report = state.report;
  const issues = state.issues;
  const gaps = report?.status === "blocked" ? [] : report?.gaps ?? [];
  const blocks = claims(report);
  const shownIssues = issues.filter((issue) =>
    report?.conflicts.some((block) => block.body.includes(issue.description.slice(0, 24))),
  ).length;
  return [
    {
      label: "Верность извлечения",
      text: count(facts.filter((fact) => fact.excerpt.trim() && fact.valueText.trim()).length, facts.length, "измерений нет"),
    },
    {
      label: "Верность даты",
      text: count(facts.filter((fact) => Boolean(fact.date)).length, facts.length, "измерений нет"),
    },
    {
      label: "Верность единицы",
      text: count(facts.filter((fact) => fact.unit.trim()).length, facts.length, "измерений нет"),
    },
    {
      label: "Противоречия в тексте",
      text: count(shownIssues, issues.length, "в документах их нет"),
    },
    {
      label: "Пробелы без поручения",
      text: count(gaps.filter((gap) => !/сдайте/i.test(gap)).length, gaps.length, "пробелов нет"),
    },
    {
      label: "Утверждения с источником",
      text: count(blocks.filter((block) => block.sources.length > 0).length, blocks.length, "утверждений нет"),
    },
    {
      label: "Утверждения без источника",
      text: count(blocks.filter((block) => block.sources.length === 0).length, blocks.length, "утверждений нет"),
    },
  ];
}
