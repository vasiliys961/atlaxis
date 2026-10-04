import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { anonymizeText } from "./anonymize";
import { AXES, CLUSTERS } from "./catalog";
import { askDoctorOpus } from "./doctor-opus";
import { EXPLAIN_SYSTEM, acceptExplanation } from "./explain";
import { sanitizeImageReading } from "./image-json";
import { decideProcessing } from "./policy";
import { acceptWording } from "./wording";
import { parseDocument } from "./parse";
import { extractPdfText } from "./pdf";
import { buildReport, validateReport } from "./report";
import { emptyState, type OwnerState } from "./types";

test("study date stays, contacts go away", () => {
  const result = anonymizeText("Иван Иванов\nEmail: ivan@example.com\nДата рождения: 12.04.1980\nДата исследования: 2024-03-12\nГемоглобин 108 г/л");
  assert.equal(result.leaked, false);
  assert.match(result.text, /2024-03-12/);
  assert.doesNotMatch(result.text, /ivan@example.com/);
  assert.doesNotMatch(result.text, /12\.04\.1980/);
  assert.match(result.text, /\[имя\]/);
});

test("blank contradiction, dose split and trend", () => {
  const first = parseDocument(anonymizeText("Дата исследования: 2024-03-12\nГемоглобин 108 г/л 120-160\nЗаключение: все показатели в пределах нормы.\nЛПНП 4.8 ммоль/л\nАторвастатин 20 мг").text);
  const second = parseDocument(anonymizeText("Дата исследования: 2025-01-09\nЛПНП 3.1 ммоль/л\nАторвастатин 40 мг").text);
  assert.equal(first.issues.length, 1);
  assert.equal(first.facts.find((fact) => fact.concept === "HGB")?.value, 108);
  assert.equal(first.medications[0]?.dose, 20);
  assert.equal(second.medications[0]?.dose, 40);

  const state: OwnerState = {
    ...emptyState(),
    region: "EU",
    documents: [
      { id: "a", fileName: "a.txt", byteSize: 1, contentHash: "1", pipelineVersion: "t", status: "ready", statusLabel: "Готово", note: "", studyDate: "2024-03-12", anonymizedText: "", createdAt: "" },
      { id: "b", fileName: "b.txt", byteSize: 1, contentHash: "2", pipelineVersion: "t", status: "ready", statusLabel: "Готово", note: "", studyDate: "2025-01-09", anonymizedText: "", createdAt: "" },
    ],
    facts: [
      ...first.facts.map((fact, index) => ({ ...fact, id: `f${index}`, documentId: "a" })),
      ...second.facts.map((fact, index) => ({ ...fact, id: `g${index}`, documentId: "b" })),
    ],
    medications: [
      { ...first.medications[0]!, id: "m1", documentId: "a" },
      { ...second.medications[0]!, id: "m2", documentId: "b" },
    ],
    issues: first.issues.map((issue, index) => ({ ...issue, id: `i${index}`, documentId: "a" })),
    report: null,
  };

  const report = buildReport(state);
  assert.equal(report.status, "ready");
  assert.match(report.changes.map((item) => item.body).join("\n"), /смена записи во времени/);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /референс этого же бланка/);
  assert.equal(report.changes.find((item) => item.title === "ЛПНП")?.body.startsWith("4.8 ммоль/л (2024-03-12), затем 3.1"), true);
  assert.match(report.headline, /измерен/);
  assert.match(report.guidelineNote, /версия 2025/);
  assert.match(report.guidelineNote, /актуальной не считается/);
  assert.doesNotMatch(JSON.stringify(report), /сдайте|назначьте|отмените|диагноз\s*:/i);
});

test("pdf text layer becomes a lipid fact", async () => {
  const text = await extractPdfText(readFileSync(new URL("../fixtures/labs.pdf", import.meta.url)));
  const parsed = parseDocument(text);
  assert.equal(parsed.facts[0]?.concept, "HDL_C");
  assert.equal(parsed.facts[0]?.value, 1.4);
});

test("image json keeps only visible fields", () => {
  const reading = sanitizeImageReading({
    diagnosis: "диабет",
    studyDate: "2024-03-12",
    lines: ["ЛПНП 4.8 ммоль/л"],
    measurements: [{ name: "гемоглобин", value: "108", unit: "г/л", referenceLow: "120", referenceHigh: "160", comment: "назначить" }],
    medications: [{ name: "аторвастатин", dose: "20", unit: "мг" }],
  });
  assert.equal(reading?.studyDate, "2024-03-12");
  assert.equal(reading?.measurements[0]?.value, "108");
  assert.equal("diagnosis" in (reading ?? {}), false);
  assert.equal(sanitizeImageReading(null), null);
});

test("wording cannot add a dose or an order", () => {
  const state = emptyState();
  state.facts.push({
    id: "f",
    documentId: "d",
    concept: "HGB",
    label: "гемоглобин",
    value: 108,
    valueText: "108",
    unit: "г/л",
    date: "2024-03-12",
    referenceLow: 120,
    referenceHigh: 160,
    line: 1,
    excerpt: "гемоглобин 108 г/л",
  });
  assert.equal(acceptWording("В бланке гемоглобин 108 г/л.", state), true);
  assert.equal(acceptWording("Сдайте анализ.", state), false);
  assert.equal(acceptWording("Примите 10 мг.", state), false);
});

test("invented dose blocks the report", () => {
  const state = emptyState();
  const report = validateReport(
    {
      ...buildReport(state),
      status: "ready",
      intro: "Примите 10 мг.",
      limits: [],
      documents: [],
      themes: [],
      changes: [],
      conflicts: [],
      gaps: [],
      questions: [],
      guidelineNote: "",
    },
    state,
  );
  assert.equal(report.status, "blocked");
});

test("working catalog has 15 clusters and 20 axes", () => {
  assert.equal(CLUSTERS.length, 15);
  assert.equal(AXES.length, 20);
  assert.equal(new Set(AXES.map((axis) => axis.id)).size, 20);
});

test("a picture may reach the eyes and not the brain", () => {
  const eyes = decideProcessing({ operation: "read_image", kind: "image", bytes: 100, hasKey: true });
  const brain = decideProcessing({ operation: "narrate", kind: "image", bytes: 100, hasKey: true });
  const dicom = decideProcessing({ operation: "read_image", kind: "dicom", bytes: 100, hasKey: true });
  const huge = decideProcessing({ operation: "read_image", kind: "image", bytes: 9 * 1024 * 1024, hasKey: true });
  assert.equal(eyes.audience, "eyes");
  assert.equal(eyes.allow, true);
  assert.equal(brain.allow, false);
  assert.equal(dicom.allow, false);
  assert.equal(huge.allow, false);
});

test("doctor opus question stays on this machine", async () => {
  const reply = askDoctorOpus("что видно на снимке");
  assert.equal(reply.connected, false);
  assert.equal(reply.sent, false);
  assert.match(reply.answer, /никуда не ушёл/);

  const child = spawn(process.execPath, ["--import", "tsx", "mcp/doctor-opus/server.ts"], { stdio: ["pipe", "pipe", "pipe"] });
  const body = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "ask_doctor_opus", arguments: { question: "что видно" } },
  }));
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error("mcp timeout")), 8000);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      const headerEnd = data.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const length = Number(data.subarray(0, headerEnd).toString("utf8").match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0);
      if (data.length < headerEnd + 4 + length) return;
      clearTimeout(timer);
      resolve(data.subarray(headerEnd + 4, headerEnd + 4 + length));
    });
  }).finally(() => child.kill());
  assert.match(raw.toString("utf8"), /никуда не ушёл/);
});

test("chat explains findings and drops diagnosis or treatment", () => {
  assert.match(EXPLAIN_SYSTEM, /Не ставь диагноз/);
  assert.match(EXPLAIN_SYSTEM, /Не назначай и не отменяй лечение/);
  const state = emptyState();
  state.facts.push({
    id: "f",
    documentId: "a",
    concept: "LDL",
    label: "ЛПНП",
    value: 4.8,
    valueText: "4.8",
    unit: "ммоль/л",
    referenceLow: null,
    referenceHigh: null,
    line: 1,
    excerpt: "ЛПНП 4.8 ммоль/л",
    date: "2024-03-12",
  });
  assert.equal(acceptExplanation("ЛПНП в бланке 4.8 ммоль/л. Это выше обычной верхней границы, которую стоит показать врачу.", state), true);
  assert.equal(acceptExplanation("Ваш диагноз: гиперхолестеринемия. Принимайте аторвастатин.", state), false);
});
