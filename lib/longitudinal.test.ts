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

test("bilirubin fractions stay separate from urine glucose and sediment", () => {
  const parsed = parseDocument([
    "Глюкоза 0.0 ммоль/л < 0.8",
    "Лейкоциты 0-1 клеток/ПЗ 0-5",
    "Глюкоза А09.05.023 (Приказ МЗ РФ № 804н) 4.40 ммоль/л 4.11 - 6.1",
    "Билирубин общий 26.4+ мкмоль/л < 21",
    "Билирубин прямой 8.2+ мкмоль/л < 5",
    "Билирубин непрямой 21.0 мкмоль/л * <19.0",
  ].join("\n"));
  const fact = (concept: string) => parsed.facts.find((item) => item.concept === concept);
  assert.equal(fact("GLU")?.value, 4.4);
  assert.equal(fact("GLU")?.referenceLow, 4.11);
  assert.equal(fact("BILI")?.value, 26.4);
  assert.equal(fact("BILI")?.referenceHigh, 21);
  assert.equal(fact("BILI_D")?.value, 8.2);
  assert.equal(fact("BILI_D")?.referenceHigh, 5);
  assert.equal(fact("BILI_I")?.value, 21);
  assert.equal(fact("BILI_I")?.referenceHigh, 19);
  assert.equal(parsed.facts.some((item) => item.concept === "WBC"), false);
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

test("printed lab rows keep the assay code and a reference glued to the unit", () => {
  const parsed = parseDocument([
    "Взятие биоматериала: 27.10.2022 09:00",
    "Эритроцитарные параметры",
    "Гемоглобин (Hb) 148,10 138,50 - 166,70г/л",
    "Эритроциты (RBC) 4,98 4,30 - 5,5710^12/л",
    "Средний объем эритроцита (MCV) 96,00 81,30 - 100,12фл",
    "Тромбоциты (PLT) 298 165 - 396,210^9/л",
    "Лейкоциты (WBC) 4,19 3,89 - 9,2310^9/л",
    "СОЭ (по Вестергрену) 11 2 - 15мм/ч",
    "Витамин D (25-ОН) (кальциферол)** 29 нг/мл",
    "30 100",
    "Цинк 8,5 10,7 - 18,4мкмоль/л",
  ].join("\n"));
  const fact = (concept: string) => parsed.facts.find((item) => item.concept === concept);
  assert.equal(fact("HGB")?.value, 148.1);
  assert.equal(fact("HGB")?.unit, "г/л");
  assert.equal(fact("HGB")?.referenceLow, 138.5);
  assert.equal(fact("HGB")?.referenceHigh, 166.7);
  assert.equal(fact("HGB")?.date, "2022-10-27");
  assert.equal(fact("RBC")?.value, 4.98);
  assert.equal(fact("RBC")?.unit, "10^12/л");
  assert.equal(fact("RBC")?.referenceHigh, 5.57);
  assert.equal(fact("PLT")?.value, 298);
  assert.equal(fact("PLT")?.unit, "10^9/л");
  assert.equal(fact("PLT")?.referenceHigh, 396.2);
  assert.equal(fact("WBC")?.unit, "10^9/л");
  assert.equal(fact("WBC")?.referenceHigh, 9.23);
  assert.equal(fact("ESR")?.value, 11);
  assert.equal(fact("ESR")?.unit, "мм/ч");
  assert.equal(fact("VITD")?.value, 29);
  assert.equal(fact("VITD")?.referenceLow, 30);
  assert.equal(fact("VITD")?.referenceHigh, 100);
  assert.equal(fact("ZINC")?.value, 8.5);
  assert.equal(fact("ZINC")?.unit, "мкмоль/л");
  assert.equal(fact("ZINC")?.referenceLow, 10.7);
  assert.equal(parsed.facts.some((item) => item.value === 96), false);
  assert.equal(parsed.issues.some((item) => /числа рядом нет/.test(item.description)), false);
});

test("measurement units may follow the result without a space", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nГемоглобин 140г/л\nHbA1c 6.4%");
  assert.deepEqual(parsed.facts.map(f => [f.value, f.unit]), [[140, "г/л"], [6.4, "%"]]);
});
