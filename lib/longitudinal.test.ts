import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "./parse";

test("longitudinal measurements in one document are not conflicting", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nЛПНП 4.8 ммоль/л\nДата исследования: 2025-01-01\nЛПНП 3.1 ммоль/л");
  assert.equal(parsed.facts.length, 2);
  assert.equal(parsed.facts[0]?.date, "2024-01-01");
  assert.equal(parsed.facts[1]?.date, "2025-01-01");
  assert.equal(parsed.issues.some(issue => issue.description.includes("записан по-разному")), false);
});

test("disagreeing values for same date remain flagged", () => {
  const parsed = parseDocument("Дата исследования: 2025-01-01\nЛПНП 4.8 ммоль/л\nЛПНП 3.1 ммоль/л");
  assert.equal(parsed.issues.some(issue => issue.description.includes("записан по-разному")), true);
});

import { buildReport } from "./report";
import { emptyState, type OwnerState } from "./types";
import { reconcileMedications } from "./medication-reconciliation";

function medicationState(text: string): OwnerState {
  const state = emptyState();
  state.documents.push({ id: "a", fileName: "history.txt", byteSize: 1, contentHash: "a", pipelineVersion: "test", status: "ready", statusLabel: "Готово", note: "", studyDate: null, anonymizedText: "", createdAt: "" });
  const parsed = parseDocument(text);
  state.medications = parsed.medications.map((m, i) => ({ ...m, id: `m${i}`, documentId: "a" }));
  state.facts = parsed.facts.map((f, i) => ({ ...f, id: `f${i}`, documentId: "a" }));
  state.issues = parsed.issues.map((issue, i) => ({ ...issue, id: `i${i}`, documentId: "a" }));
  return state;
}

test("invalid date after a valid section cannot reuse the previous date", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nГемоглобин 140 г/л\nДата исследования: 2024-02-31\nГемоглобин 110 г/л\nАторвастатин 20 мг\nДата исследования: 2025-01-01\nГемоглобин 120 г/л");
  assert.deepEqual(parsed.facts.map(f => f.date), ["2024-01-01", null, "2025-01-01"]);
  assert.equal(parsed.facts[1]?.dateStatus, "unknown");
  assert.equal(parsed.medications[0]?.date, null);
});

test("future date also clears the previous section date", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nГемоглобин 140 г/л\nДата исследования: 2999-01-01\nАторвастатин 20 мг");
  assert.equal(parsed.medications[0]?.date, null);
  assert.equal(parsed.studyDate, null);
});

test("different dated doses within one discharge summary are a written change", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nАторвастатин 10 мг 1 раз в сутки\nДата исследования: 2025-01-01\nАторвастатин 20 мг 1 раз в сутки");
  const report = buildReport(state);
  assert.equal(report.status, "ready");
  assert.equal(report.changes.filter(b => b.title === "Смена дозы").length, 1);
  assert.equal(report.conflicts.some(b => b.title === "Разные дозы"), false);
  const change = report.changes.find(b => b.title === "Смена дозы")!;
  assert.deepEqual(change.sources.map(s => s.line), [2, 4]);
  assert.match(change.body, /фактический приём.*не устанавливаются/);
});

test("same-day frequency disagreement is retained even when doses match", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nМетопролол 25 мг 1 раз в сутки\nМетопролол 25 мг 2 раза в сутки");
  const result = reconcileMedications(state);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.changes.length, 0);
  const report = buildReport(state);
  assert.match(report.conflicts.find(b => b.title === "Разные дозы")?.body ?? "", /1 раз в сутки.*2 раза в сутки/);
});

test("dated frequency change is visible without inferring daily dose", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nМетопролол 25 мг 1 раз в сутки\nДата исследования: 2025-01-01\nМетопролол 25 мг 2 раза в сутки");
  const report = buildReport(state);
  assert.equal(report.status, "ready");
  assert.equal(report.changes.filter(b => b.title === "Смена дозы").length, 1);
  assert.doesNotMatch(report.changes.map(b => b.body).join(" "), /50 мг/);
});

test("different dose units on the same day require reconciliation", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nЛевотироксин 50 мкг\nЛевотироксин 50 мг");
  assert.equal(reconcileMedications(state).conflicts.length, 1);
});

test("mixed units across dates do not create a dose trend", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nЛевотироксин 50 мкг\nДата исследования: 2025-01-01\nЛевотироксин 1 мг");
  assert.equal(reconcileMedications(state).changes.length, 0);
});

test("undated dose variation in one document is retained for review", () => {
  const state = medicationState("Аторвастатин 10 мг\nАторвастатин 20 мг");
  const result = reconcileMedications(state);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.changes.length, 0);
});

test("unknown date prevents a reassuring trend from dated subsets", () => {
  const state = medicationState("Аторвастатин 40 мг\nДата исследования: 2024-01-01\nАторвастатин 10 мг\nДата исследования: 2025-01-01\nАторвастатин 20 мг");
  assert.equal(reconcileMedications(state).changes.length, 0);
});

test("unready medication documents cannot contribute changes or conflicts", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nАторвастатин 10 мг\nАторвастатин 20 мг");
  state.documents[0]!.status = "failed";
  assert.deepEqual(reconcileMedications(state), { changes: [], conflicts: [], missing: [] });
});

test("unparseable date header resets chronological context", () => {
  for (const date of ["не указана", "12.03.24", "", "2024-1-01"]) {
    const parsed = parseDocument(`Дата исследования: 2024-01-01\nГемоглобин 140 г/л\nДата исследования: ${date}\nАторвастатин 20 мг`);
    assert.equal(parsed.medications[0]?.date, null, date);
    assert.equal(parsed.issues.length, 1, date);
  }
});

test("medication axis counts agree with the patient report", () => {
  const state = medicationState("Дата исследования: 2024-01-01\nАторвастатин 10 мг 1 раз в сутки\nДата исследования: 2025-01-01\nАторвастатин 20 мг 1 раз в сутки");
  const report = buildReport(state);
  const axis = report.axisResults?.find(a => a.axisId === "dose_over_time");
  assert.equal(axis?.trendCount, 1);
  assert.equal(axis?.conflictCount, 0);
  assert.equal(report.changes.length, 1);
});

test("missing medication chronology is partial and visible in gaps", () => {
  const state = medicationState("Аторвастатин 20 мг");
  const report = buildReport(state);
  const axis = report.axisResults?.find(a => a.axisId === "dose_over_time");
  assert.equal(axis?.status, "partial_data");
  assert.equal(axis?.missingCount, 2);
  assert.match(report.gaps.join(" "), /без даты/);
  assert.match(report.gaps.join(" "), /суточная доза не определяется/);
});

test("blood count powers in units are never extracted as measured values", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nWBC 5.8 10^9/л 4-10\nPLT 250 10^9/л 150-400\nRBC 4.6 10^12/л 4-5.5");
  assert.deepEqual(parsed.facts.map(f => [f.concept, f.value, f.unit]), [["WBC", 5.8, "10^9/л"], ["PLT", 250, "10^9/л"], ["RBC", 4.6, "10^12/л"]]);
  assert.equal(parsed.facts[0]?.referenceLow, 4);
  assert.equal(parsed.facts[0]?.referenceHigh, 10);
});

test("renal units containing numbers and glycated hemoglobin names retain the true result", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\neGFR 62 мл/мин/1.73м2\nHbA1c 6.4 %\nHbA1c");
  assert.deepEqual(parsed.facts.map(f => [f.concept, f.value, f.unit]), [["EGFR", 62, "мл/мин/1.73м2"], ["HBA1C", 6.4, "%"]]);
});

test("multisystem laboratory results preserve values and references", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nГемоглобин 110 г/л 120-160\nГлюкоза 5,5 ммоль/л 3.3-6.1\nКреатинин 95 мкмоль/л\nАЛТ 32 Ед/л\nТТГ 2.1 мЕд/л\nСРБ 5 мг/л\nФерритин 35 нг/мл\nНатрий 140 ммоль/л\nКалий 4.3 ммоль/л\nМНО 1.1\nАД 130/80");
  assert.equal(parsed.facts.length, 12);
  assert.equal(parsed.facts.find(f => f.concept === "GLU")?.value, 5.5);
  assert.equal(parsed.facts.find(f => f.concept === "HGB")?.referenceHigh, 160);
  assert.equal(parsed.facts.find(f => f.concept === "TSH")?.value, 2.1);
});

test("measurement units may follow the result without a space", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nГемоглобин 140г/л\nHbA1c 6.4%");
  assert.deepEqual(parsed.facts.map(f => [f.value, f.unit]), [[140, "г/л"], [6.4, "%"]]);
});
