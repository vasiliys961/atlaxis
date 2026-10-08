import type { FactStatus, OwnerState, SourceRef } from "./types";

export type MeasurementHistory = {
  concept: string;
  label: string;
  limitations: string[];
  entries: { date: string | null; value: string; unit: string; low: number | null; high: number | null; status: FactStatus; source: SourceRef }[];
};

export function measurementHistory(state: OwnerState): MeasurementHistory[] {
  const documents = new Map(state.documents.filter(d => d.status === "ready").map(d => [d.id, d]));
  const groups = new Map<string, MeasurementHistory>();
  for (const fact of state.facts) {
    const document = documents.get(fact.documentId);
    if (!document) continue;
    const group = groups.get(fact.concept) ?? { concept: fact.concept, label: fact.label, limitations: [], entries: [] };
    group.entries.push({ date: fact.date, value: fact.valueText, unit: fact.unit, low: fact.referenceLow, high: fact.referenceHigh, status: fact.status,
      source: { documentId: document.id, documentName: document.fileName, line: fact.line, excerpt: fact.excerpt } });
    groups.set(fact.concept, group);
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.source.documentName.localeCompare(b.source.documentName) || a.source.line - b.source.line);
    const units = new Set(group.entries.map(e => e.unit.trim().toLowerCase()));
    if (units.size > 1 || units.has("")) group.limitations.push("Единицы различаются или отсутствуют: числовая динамика без проверки не сравнивается.");
    const references = new Set(group.entries.map(e => `${e.low ?? "?"}|${e.high ?? "?"}`));
    if (references.size > 1) group.limitations.push("Референсы бланков различаются. Положение относительно референса оценивается отдельно для каждой записи.");
    if (group.entries.some(e => !e.date)) group.limitations.push("Есть записи без даты: их место в последовательности неизвестно.");
    if (group.entries.some(e => e.status !== "extracted")) group.limitations.push("Есть неопределённые или противоречивые результаты: требуется сверка с документом.");
    const dates = new Map<string, Set<string>>();
    for (const entry of group.entries) if (entry.date) {
      const values = dates.get(entry.date) ?? new Set<string>();
      values.add(`${entry.value}|${entry.unit.trim().toLowerCase()}`); dates.set(entry.date, values);
    }
    if ([...dates.values()].some(values => values.size > 1)) group.limitations.push("На одну дату записаны разные результаты; время забора и причины различия не установлены.");
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
}
