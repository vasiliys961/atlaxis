import test from "node:test";
import assert from "node:assert/strict";
import { documentReadingText } from "./document-reading";
import { mergeReadings, sanitizeImageReading } from "./image-json";
import { buildReport, validateReport } from "./report";
import { emptyState, type MedicalFact } from "./types";

test("a long page keeps lines past the old forty-line cut", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `Строка ${index + 1}: заключение без показателя словаря`);
  const reading = sanitizeImageReading({ lines, measurements: [], medications: [], studyDate: "" });
  assert.equal(reading?.lines.length, 50);
  assert.equal(mergeReadings([reading!, { ...reading!, lines: reading!.lines }]).lines.length, 100);
});

test("the sheet shows the whole file, including lines outside the dictionary", () => {
  const state = emptyState();
  state.documents.push({
    id: "note",
    fileName: "note.txt",
    byteSize: 1,
    contentHash: "note",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: null,
    anonymizedText: "Заключение: синусовый ритм. Жалобы на одышку при ходьбе.",
    createdAt: "",
  });
  state.documents.push({
    id: "scan",
    fileName: "scan.jpg",
    byteSize: 1,
    contentHash: "scan",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: null,
    anonymizedText: JSON.stringify({
      studyDate: "",
      lines: ["Антитела к CCP 45 Ед/мл", "Заключение: без острого процесса"],
      measurements: [{ name: "Антитела к CCP", value: "45", unit: "Ед/мл", referenceLow: "", referenceHigh: "" }],
      medications: [],
    }),
    createdAt: "",
  });
  const report = buildReport(state);
  assert.match(report.readings?.find((item) => item.name === "note.txt")?.text ?? "", /одышку при ходьбе/);
  const scan = report.readings?.find((item) => item.name === "scan.jpg")?.text ?? "";
  assert.match(scan, /Антитела к CCP/);
  assert.match(scan, /без острого процесса/);
  assert.equal(documentReadingText(state.documents[1]!.anonymizedText).includes("45"), true);
});

test("trailing zeros in a printed row do not hide the sheet", () => {
  const state = emptyState();
  const fact: MedicalFact = {
    id: "f",
    documentId: "d",
    concept: "HGB",
    label: "Гемоглобин",
    value: 148.1,
    valueText: "148.1",
    unit: "г/л",
    date: "2022-10-27",
    dateStatus: "known",
    referenceLow: 138.5,
    referenceHigh: 166.7,
    line: 1,
    excerpt: "148,10 138,50 - 166,70г/л",
    extraction: "text",
    status: "extracted",
  };
  state.documents.push({
    id: "d",
    fileName: "lab.txt",
    byteSize: 1,
    contentHash: "lab",
    pipelineVersion: "test",
    status: "ready",
    statusLabel: "Готово",
    note: "",
    studyDate: "2022-10-27",
    anonymizedText: "Заключение терапевта: наблюдение.",
    createdAt: "",
  });
  state.facts.push(fact);
  const report = buildReport(state);
  assert.equal(report.status, "ready");
  assert.match(report.readings?.[0]?.text ?? "", /наблюдение/);
  const blocked = validateReport({ ...report, intro: "Примите 10 мг.", limits: [] }, state);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.readings?.[0]?.text ?? "", /наблюдение/);
});
