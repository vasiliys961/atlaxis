import test from "node:test";
import assert from "node:assert/strict";
import { instrumentStudies } from "./instrument-studies";
import { emptyState, type OwnerState } from "./types";
import { buildClinicalContext } from "./clinical-context";
import { buildReport } from "./report";
function state(text: string, fileName = "study.txt"): OwnerState {
  const s = emptyState(); s.documents.push({ id: "study", fileName, anonymizedText: text, status: "ready", statusLabel: "", note: "", contentHash: "hash", byteSize: text.length, studyDate: null, pipelineVersion: "test", createdAt: "2025-01-01" }); return s;
}
test("ECG prints distinguish QT from QTc and preserve source lines", () => {
  const studies = instrumentStudies(state("ЭКГ\nЧСС: 72 bpm\nPR 160 ms\nQRS 90 мс\nQT 400 ms\nQTc 430 ms\nскорость 25 мм/с\nусиление 10 мм/мВ"));
  assert.equal(studies[0].parameters.length, 7);
  assert.equal(studies[0].parameters.find(p => p.name === "QTc")?.valueText, "430");
  assert.equal(studies[0].parameters.find(p => p.name === "QT")?.source.line, 5);
});
test("no pixel measurement or invented value with curve-only ECG", () => {
  const s = instrumentStudies(state("ЭКГ\nКривая в отведении II"));
  assert.equal(s[0].parameters.length, 0);
});
test("spirometry percent predicted and table columns never become measured volume", () => {
  const study = instrumentStudies(state("Спирометрия\nFEV1 2.5 L\nFEV1 78 %\nFVC 3.5 4.0 88\nFEV1/FVC 71 %"))[0];
  assert.equal(study.parameters[0].status, "printed");
  assert.equal(study.parameters[1].valueText, null);
  assert.equal(study.parameters[2].status, "ambiguous");
  assert.equal(study.parameters[3].name, "FEV1/FVC");
  assert.equal(study.parameters[3].valueText, "71");
});
test("missing units, negative values and incompatible units remain ambiguous", () => {
  const s = instrumentStudies(state("ЭКГ\nQRS 100\nPR -10 ms\nQTc 440 bpm"))[0];
  assert.ok(s.parameters.every(p => p.status === "ambiguous" && p.valueText === null));
});
test("images get same source identifiers as clinical context; failed files excluded", () => {
  const s = state(JSON.stringify({ lines: ["ЭКГ", "QTc 420 ms"], studyDate: "2025-01-01", measurements: [], medications: [] }), "image.png");
  const study = instrumentStudies(s)[0];
  const context = buildClinicalContext(s);
  assert.equal(context.sources.get(`study:${study.parameters[0].source.line}`)?.excerpt, "QTc 420 ms");
  assert.ok(buildReport(s).instrumentStudies?.length);
  s.documents[0].status = "failed";
  assert.equal(instrumentStudies(s).length, 0);
});
test("recorded conclusion stays explicitly separate from service findings", () => {
  const s = instrumentStudies(state("ЭКГ\nЗаключение: синусовый ритм\nQRS 90 ms"))[0];
  assert.equal(s.recordedConclusions[0].excerpt, "Заключение: синусовый ритм");
  assert.ok(s.limitations.some(l => l.includes("Диагноз")));
});

test("professor accepts printed interval but rejects invented instrument number", async () => {
  const { acceptExplanation } = await import("./explain");
  const s = state("ЭКГ\nQRS 90 ms");
  assert.equal(acceptExplanation("В документе QRS 90 ms.", s), true);
  assert.equal(acceptExplanation("В документе QRS 120 ms.", s), false);
});
