import assert from "node:assert/strict";
import test from "node:test";
import { analyzeClinicalState } from "./clinical-engine";
import { buildReport } from "./report";
import { aggregateEvaluations } from "./evaluation";
import { emptyState, type MedicalFact, type OwnerState } from "./types";

function sample(): OwnerState {
  const state = emptyState();
  for (const id of ["a", "b", "c"]) {
    state.documents.push({ id, fileName: id + ".txt", byteSize: 1, contentHash: id, pipelineVersion: "test", status: "ready", statusLabel: "Готово", note: "", studyDate: null, anonymizedText: "", createdAt: "" });
  }
  return state;
}
function fact(id: string, documentId: string, date: string, value: number, unit = "ммоль/л"): MedicalFact {
  return { id, documentId, date, dateStatus: "known", concept: "LDL_C", label: "ЛПНП", value, valueText: String(value), unit, referenceLow: null, referenceHigh: null, line: 1, excerpt: "ЛПНП", extraction: "text", status: "extracted" };
}
test("two dated values with identical units create a source-backed trend", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),fact("f2","b","2025-01-01",3.1));
  const result = analyzeClinicalState(state);
  const trend = result.axes.find(a => a.axisId === "lipid_profile")?.trends[0];
  assert.equal(trend?.sourceRefs.length, 2);
  assert.match(trend?.explanation ?? "", /причина изменения.*не устанавливается/);
});
test("mixed units cannot be interpreted as a trend", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),fact("f2","b","2025-01-01",180,"мг/дл"));
  assert.equal(analyzeClinicalState(state).axes.find(a => a.axisId === "lipid_profile")?.trends.length, 0);
});
test("a conflicting series cannot produce a trend", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),fact("f2","b","2025-01-01",3.1),fact("f3","c","2025-01-01",5.2));
  const axis = analyzeClinicalState(state).axes.find(a => a.axisId === "lipid_profile");
  assert.equal(axis?.trends.length, 0);
  assert.equal(axis?.conflicts.length, 1);
});
test("same-month unrelated facts do not create a clinical relationship", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),{...fact("f2","b","2024-01-22",5.5),concept:"GLU",label:"Глюкоза"});
  assert.equal(analyzeClinicalState(state).relations.length,0);
});
test("invalid independent evaluation is blocked", () => {
  const dimensions = { factualAccuracy: 5, completeness: 5, temporalAnalysis: 5, contradictionDetection: 5, missingDataDetection: 5, relationshipPrecision: 5, guidelineAccuracy: 5, safety: 5, clarity: 5 };
  const summary = aggregateEvaluations([{model:"test",overall:Number.NaN,dimensions,findings:[],verdict:"pass"}]);
  assert.equal(summary?.verdict,"block");
});

test("patient report does not claim a trend across incompatible units", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),fact("f2","b","2025-01-01",180,"мг/дл"));
  const report = buildReport(state);
  assert.equal(report.changes.some(block => block.title === "ЛПНП"), false);
});

test("medication and imaging axes reflect actual ready documents", () => {
  const state = sample();
  state.medications.push({ id:"m",documentId:"a",name:"аторвастатин",dose:20,doseText:"20",unit:"мг",date:"2024-01-01",line:1,excerpt:"аторвастатин 20 мг" });
  const result = analyzeClinicalState(state);
  assert.equal(result.axes.find(a => a.axisId === "medications_as_written")?.status,"sufficient_data");
  assert.equal(result.axes.find(a => a.axisId === "imaging")?.status,"insufficient_data");
});
test("contradictions within a single document are recorded without pretending to be cross-document", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2024-01-01",4.8),fact("f2","a","2024-01-01",5.8));
  const result = analyzeClinicalState(state);
  assert.equal(result.axes.find(a => a.axisId === "lipid_profile")?.conflicts.length,1);
  assert.equal(result.relations.some(r => r.type === "same_measurement_different_document"),false);
});

test("same-day incompatible units are flagged for manual review, not numerically compared", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2025-01-01",4.8), fact("f2","b","2025-01-01",185,"мг/дл"));
  const axis = analyzeClinicalState(state).axes.find(a => a.axisId === "lipid_profile");
  assert.equal(axis?.conflicts.length, 1);
  assert.match(axis?.conflicts[0]?.explanation ?? "", /единицы измерения/);
  assert.equal(axis?.trends.length, 0);
  assert.equal(analyzeClinicalState(state).relations.some(r => r.type === "same_measurement_different_document"), true);
});

test("same-day measurements with identical values and units are not discrepancies", () => {
  const state = sample();
  state.facts.push(fact("f1","a","2025-01-01",4.8), fact("f2","b","2025-01-01",4.8));
  assert.equal(analyzeClinicalState(state).axes.find(a => a.axisId === "lipid_profile")?.conflicts.length, 0);
});
