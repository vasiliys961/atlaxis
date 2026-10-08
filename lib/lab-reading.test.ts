import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLabReading } from "./lab-reading";
import { readingLines, type ImageReading } from "./image-json";
const reading = (line: string, changes = {}): ImageReading => ({ studyDate: "2025-01-01", lines: [line], medications: [], measurements: [{ name: "гемоглобин", value: "130", unit: "г/л", referenceLow: "120", referenceHigh: "160", ...changes }] });
test("matching OCR and structured row become one fact without losing original source", () => {
  const r = reading("гемоглобин 130 г/л 120-160");
  const p = reconcileLabReading(r);
  assert.equal(p.facts.length, 1);
  assert.equal(p.facts[0].line, 3);
  assert.equal(p.facts[0].referenceLow, 120);
  assert.equal(p.facts[0].status, "extracted");
  assert.ok(readingLines(r).includes(r.lines[0]));
});
test("disagreeing value, units and reference keep both alternatives as conflicting", () => {
  const p = reconcileLabReading(reading("гемоглобин 13 г/дл 12-16"));
  assert.equal(p.facts.length, 2);
  assert.ok(p.facts.every(f => f.status === "conflicting"));
  assert.ok(p.issues.some(i => i.description.includes("OCR") && i.otherLine));
});
test("one sided reference is retained without contaminating unit", () => {
  const p = reconcileLabReading(reading("гемоглобин 130 г/л", { referenceLow: "", referenceHigh: "160" }));
  assert.equal(p.facts.length, 1);
  assert.equal(p.facts[0].referenceHigh, 160);
  assert.equal(p.facts[0].referenceLow, null);
  assert.equal(p.facts[0].unit, "г/л");
});
test("reference disagreement alone blocks confident interpretation", () => {
  const p = reconcileLabReading(reading("гемоглобин 130 г/л 110-150"));
  assert.equal(p.facts.length, 2);
  assert.ok(p.facts.every(f => f.status === "conflicting"));
});
test("multiple dates never assign structured row to the last OCR sample", () => {
  const r = reading("гемоглобин 130 г/л");
  r.lines.push("Дата исследования: 2025-02-01", "гемоглобин 140 г/л");
  const p = reconcileLabReading(r);
  assert.equal(p.studyDate, null);
  assert.equal(p.facts.at(-1)?.date, null);
  assert.ok(p.issues.some(i => i.description.includes("однозначно")));
});
test("qualitative and censored values stay in sources, never become exact numbers", () => {
  const r = reading("гемоглобин <130 г/л", { value: "<130" });
  assert.equal(reconcileLabReading(r).facts.length, 0);
  assert.ok(readingLines(r).includes("<130"));
});
test("unknown marker remains readable to whole-context synthesis", () => {
  const r = reading("Антитела к CCP 45 Ед/мл", { name: "Антитела к CCP", value: "45", unit: "Ед/мл" });
  assert.equal(reconcileLabReading(r).facts.length, 0);
  assert.ok(readingLines(r).includes("Антитела к CCP"));
});

test("ingestion and report preserve an OCR reference conflict with two source lines", async () => {
  const { settleDocument } = await import("./ingest");
  const { emptyState, PIPELINE_VERSION } = await import("./types");
  const { buildReport } = await import("./report");
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  global.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify(reading("гемоглобин 130 г/л 110-150")) } }] })) as typeof fetch;
  try {
    const state = emptyState();
    const doc = { id: "lab-image", fileName: "lab.png", byteSize: 1, contentHash: "hash", pipelineVersion: PIPELINE_VERSION, studyDate: null, anonymizedText: "", createdAt: "2025-01-01", status: "queued" as const, statusLabel: "", note: "" };
    state.documents.push(doc);
    await settleDocument(state, doc, Buffer.from("fixture"));
    const report = buildReport(state);
    assert.equal(state.facts.length, 2);
    assert.ok(state.facts.every(f => f.status === "conflicting"));
    assert.ok(report.conflicts.some(c => c.body.includes("OCR")));
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});
