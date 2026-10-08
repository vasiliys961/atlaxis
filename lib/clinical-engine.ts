import { AXES, type AxisStatus } from "./catalog";
import type { MedicalFact, OwnerState, SourceRef } from "./types";

type Trend = { explanation: string; sourceRefs: SourceRef[] };
type Conflict = { explanation: string; sourceRefs: SourceRef[] };
type Relation = { type: "trend" | "same_measurement_different_document"; explanation: string; sourceRefs: SourceRef[] };
type AxisResult = { axisId: string; title: string; status: AxisStatus; facts: MedicalFact[]; trends: Trend[]; conflicts: Conflict[]; missing: string[] };

function source(state: OwnerState, fact: MedicalFact): SourceRef {
  return { documentId: fact.documentId, documentName: state.documents.find(d => d.id === fact.documentId)?.fileName ?? "документ", line: fact.line, excerpt: fact.excerpt };
}
export function analyzeClinicalState(state: OwnerState): { axes: AxisResult[]; relations: Relation[] } {
  const ready = new Set(state.documents.filter(d => d.status === "ready").map(d => d.id));
  const facts = state.facts.filter(f => ready.has(f.documentId));
  const relations: Relation[] = [];
  const axes = AXES.map(axis => {
    const axisFacts = facts.filter(f => axis.concepts.includes(f.concept));
    const missing = axis.required.filter(c => !axisFacts.some(f => f.concept === c));
    const trends: Trend[] = [];
    const conflicts: Conflict[] = [];
    for (const concept of axis.concepts) {
      const rows = axisFacts.filter(f => f.concept === concept);
      const byDate = new Map<string, MedicalFact[]>();
      for (const row of rows) if (row.date) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
      for (const [date, sameDate] of byDate) {
        const distinct = new Set(sameDate.map(f => `${f.value}|${f.unit.trim().toLowerCase()}`));
        if (distinct.size > 1) {
          const refs = sameDate.map(f => source(state, f));
          const explanation = `В записях показателя ${sameDate[0].label} на ${date} есть расхождение. Уточните первичный бланк.`;
          conflicts.push({ explanation, sourceRefs: refs });
          relations.push({ type: "same_measurement_different_document", explanation, sourceRefs: refs });
        }
      }
      const dated = rows.filter(f => f.date && f.unit.trim() && Number.isFinite(f.value) && !byDate.get(f.date)?.some(other => other.id !== f.id && (other.value !== f.value || other.unit !== f.unit)));
      const units = new Set(dated.map(f => f.unit.trim().toLowerCase()));
      if (dated.length >= 2 && units.size === 1) {
        const sorted = [...dated].sort((a,b) => a.date!.localeCompare(b.date!));
        const first = sorted[0], last = sorted[sorted.length - 1];
        if (first.date !== last.date && first.value !== last.value) {
          const explanation = `${first.label}: ${first.valueText} ${first.unit} (${first.date}), затем ${last.valueText} ${last.unit} (${last.date}); причина изменения по этим данным не устанавливается.`;
          const sourceRefs = [source(state, first), source(state, last)];
          trends.push({ explanation, sourceRefs });
          relations.push({ type: "trend", explanation, sourceRefs });
        }
      }
    }
    const status: AxisStatus = axisFacts.length === 0 ? "insufficient_data" : missing.length === 0 ? "sufficient_data" : "partial_data";
    return { axisId: axis.id, title: axis.title, status, facts: axisFacts, trends, conflicts, missing };
  });
  return { axes, relations };
}
