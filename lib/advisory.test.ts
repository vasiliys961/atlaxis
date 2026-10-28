import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvisory } from "./advisory";
import { emptyState, type MedicalFact } from "./types";

function fact(changes: Partial<MedicalFact> = {}): MedicalFact {
  return {
    id: "f",
    documentId: "d",
    concept: "BILI",
    label: "Билирубин общий",
    value: 29.1,
    valueText: "29.1",
    unit: "мкмоль/л",
    date: "2025-11-03",
    dateStatus: "known",
    referenceLow: 3.4,
    referenceHigh: 20.5,
    line: 2,
    excerpt: "Билирубин общий 29.1 мкмоль/л 3.4-20.5",
    extraction: "text",
    status: "extracted",
    ...changes,
  };
}

test("advisory leads with deviations and a focused discussion plan", () => {
  const state = emptyState();
  state.documents.push({
    id: "d",
    fileName: "lab.jpg",
    byteSize: 1,
    contentHash: "x",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: "2025-11-03",
    anonymizedText: "",
    createdAt: "",
  });
  state.facts.push(
    fact(),
    fact({ id: "normal", concept: "TSH", label: "ТТГ", value: 1.9, valueText: "1.9", unit: "мЕд/л", referenceLow: 0.4, referenceHigh: 4 }),
  );
  const advisory = buildAdvisory(state);
  assert.match(advisory.summary, /билирубин/);
  assert.doesNotMatch(advisory.summary, /Сначала сверить/);
  assert.equal(advisory.priorities.some((item) => item.level === "attention" && item.summary.includes("29.1")), true);
  assert.equal(advisory.issues.some((item) => item.id === "liver_enzymes" && item.questions.some((question) => /фракциями/.test(question))), true);
  assert.equal(advisory.issues.some((item) => item.id === "thyroid_function"), false);
  assert.doesNotMatch(JSON.stringify(advisory), /нет давления|нет липидов/);
});

test("normal isolated values do not become artificial problems", () => {
  const state = emptyState();
  state.documents.push({
    id: "d",
    fileName: "lab.txt",
    byteSize: 1,
    contentHash: "x",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: null,
    anonymizedText: "",
    createdAt: "",
  });
  state.facts.push(fact({ value: 10, valueText: "10" }));
  const advisory = buildAdvisory(state);
  assert.equal(advisory.priorities.length, 0);
  assert.equal(advisory.issues.length, 0);
  assert.match(advisory.summary, /выходов/);
});

test("urine rows and blank mismatches do not hide bilirubin or the ultrasound finding", () => {
  const state = emptyState();
  state.documents.push({
    id: "labs",
    fileName: "labs.jpg",
    byteSize: 1,
    contentHash: "x",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: "2025-10-30",
    anonymizedText: JSON.stringify({
      lines: [
        "Глюкоза 0.0 ммоль/л < 0.8",
        "Лейкоциты 0-1 клеток/ПЗ 0-5",
        "Глюкоза А09.05.023 (Приказ МЗ РФ № 804н) 4.40 ммоль/л 4.11 - 6.1",
        "Билирубин общий 26.4+ мкмоль/л < 21",
        "Билирубин прямой 8.2+ мкмоль/л < 5",
        "Билирубин общий 29.1 мкмоль/л * 3.4 - 20.5",
        "Билирубин непрямой 21.0 мкмоль/л * <19.0",
      ],
    }),
    createdAt: "",
  }, {
    id: "us",
    fileName: "us.jpg",
    byteSize: 1,
    contentHash: "y",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: "2025-11-03",
    anonymizedText: JSON.stringify({
      lines: [
        "в области тела визуализируется пристеночное эхогенное образование размерами 4.7х4.0 мм, несмещаемое",
        "Заключение: Полип желчного пузыря.",
        "Заключение УЗИ не является диагнозом и требует интерпретации лечащим врачом.",
      ],
    }),
    createdAt: "",
  });
  state.facts.push(fact({ concept: "GLU", label: "глюкоза", value: 0, valueText: "0.0", unit: "ммоль/л < 0.8", status: "conflicting", referenceLow: null, referenceHigh: null }));
  const advisory = buildAdvisory(state);
  assert.match(advisory.summary, /билирубин/);
  assert.match(advisory.summary, /полип/);
  assert.match(advisory.summary, /нельзя автоматически/);
  assert.doesNotMatch(JSON.stringify(advisory), /Сначала сверить|глюкоз|МНО/i);
  assert.equal(advisory.issues.some((issue) => issue.id === "liver_enzymes" && issue.considerations.some((item) => /желчных путей/.test(item))), true);
  assert.equal(advisory.issues.some((issue) => issue.title === "Желчный пузырь"), true);
});
