import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { anonymizeText } from "./anonymize";
import { AXES, CLUSTERS } from "./catalog";
import { askDoctorOpus } from "./doctor-opus";
import { EXPLAIN_SYSTEM, acceptExplanation } from "./explain";
import { acceptGuidelineSearch, guidelineSearchPrompt } from "./guidelines-search";
import { sanitizeImageReading } from "./image-json";
import { decideProcessing } from "./policy";
import { acceptWording } from "./wording";
import { BRAIN_MODELS, LUNA, SONNET } from "./models";
import { readLuna, routeQuestion, writerFor } from "./router";
import { parseDocument } from "./parse";
import { themePrompt } from "./publish";
import { extractPdfText } from "./pdf";
import { buildReport, validateReport } from "./report";
import { emptyState, type OwnerState } from "./types";

test("a theme is retold on its own and not as the whole chart", () => {
  const prompt = themePrompt("Кровь", "гемоглобин 108 г/л");
  assert.match(prompt, /не весь комплект/);
  assert.match(prompt, /только её/);
  assert.match(prompt, /Кровь/);
  assert.match(prompt, /Не ставь диагноз/);
  assert.doesNotMatch(prompt, /ЛПНП/);
});

test("a calm theme goes to sonnet and a disputed one to opus", () => {
  assert.equal(writerFor({ body: "глюкоза 6.4 ммоль/л", lead: "Данных по теме достаточно, чтобы прочитать записанные числа." }).id, SONNET.id);
  assert.equal(writerFor({ body: "гемоглобин 108 г/л. Запись спорная: число оставлено как в строке." }).id, BRAIN_MODELS[0].id);
  assert.equal(SONNET.id, "anthropic/claude-sonnet-5.5");
  assert.equal(LUNA.id, "openai/gpt-6-luna");
  assert.doesNotMatch(LUNA.id, /pro|5\.6/i);
  assert.equal(routeQuestion("можно ли отменить варфарин"), "safety_meds");
  assert.equal(routeQuestion("боль в груди уже час"), "safety_urgent");
  assert.equal(routeQuestion("что значит глюкоза"), "sonnet");
  assert.equal(routeQuestion("почему доза другая"), "opus");
  assert.equal(routeQuestion("а это вообще серьёзно"), "luna");
  assert.equal(readLuna("urgent"), "urgent");
  assert.equal(readLuna("ordinary question"), "ordinary");
});

test("the second brain is gpt 6.1 and not astra", () => {
  const gpt = BRAIN_MODELS[1];
  assert.equal(gpt?.id, "openai/gpt-6.1-sol");
  assert.equal(gpt?.label, "GPT-6.1");
  assert.doesNotMatch(BRAIN_MODELS.map((model) => model.id).join(" "), /astra/i);
});

test("one document keeps both numbers, both dates and an inverted pressure", () => {
  const parsed = parseDocument("Дата исследования: 2024-03-12\nГемоглобин 108 г/л\nГемоглобин 140 г/л\nДата исследования: 2025-01-09\nАД 90/120\nГлюкоза повышена");
  assert.equal(parsed.facts.filter((fact) => fact.concept === "HGB").length, 2);
  const text = parsed.issues.map((item) => item.description).join("\n");
  assert.match(text, /не выбирает одно число/);
  assert.match(text, /разные даты/);
  assert.match(text, /не больше нижнего/);
  assert.match(text, /числа рядом нет/);
  assert.equal(parsed.issues.find((item) => /не выбирает одно число/.test(item.description))?.otherLine != null, true);
});

test("dose keeps the written frequency and a broken date stays out", () => {
  const parsed = parseDocument("Дата исследования: 2024-02-31\nАторвастатин 20 мг 1 раз в сутки\nГемоглобин 140 г/л");
  assert.equal(parsed.studyDate, null);
  assert.equal(parsed.facts[0]?.date, null);
  assert.match(parsed.issues.map((item) => item.description).join(" "), /календарную/);
  assert.equal(parsed.medications[0]?.dose, 20);
  assert.equal(parsed.medications[0]?.frequency, "1 раз в сутки");
});

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
  assert.match(report.questions.join("\n"), /Вопрос врачу: .+референс этого же бланка/);
  const blood = report.themes.find((item) => item.title === "Кровь");
  assert.equal(blood?.body.split("\n").filter(Boolean).length, blood?.sources.length);
  assert.match(blood?.lead ?? "", /достаточно/);
  const hemoglobin = state.facts.find((fact) => fact.concept === "HGB");
  assert.equal(hemoglobin?.status, "conflicting");
  const issue = state.issues[0];
  if (hemoglobin && issue) {
    issue.line = 999;
    issue.excerpt = hemoglobin.excerpt;
    buildReport(state);
    assert.equal(hemoglobin.status, "conflicting");
  }
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
    dateStatus: "known",
    referenceLow: 120,
    referenceHigh: 160,
    line: 1,
    excerpt: "гемоглобин 108 г/л",
    extraction: "text",
    status: "extracted",
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
    dateStatus: "known",
    extraction: "text",
    status: "extracted",
  });
  assert.equal(acceptExplanation("ЛПНП в бланке 4.8 ммоль/л. Это выше обычной верхней границы, которую стоит показать врачу.", state), true);
  assert.equal(acceptExplanation("Ваш диагноз: гиперхолестеринемия. Принимайте аторвастатин.", state), false);
});

test("sonar looks up guidelines for the recorded labs only", () => {
  const prompt = guidelineSearchPrompt("RU", "ЛПНП: 4.8 ммоль/л, 2024-03-12");
  assert.match(prompt, /Минздрава России/);
  assert.match(prompt, /Не ставь диагноз/);
  assert.match(prompt, /Не назначай и не отменяй лечение/);
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
    dateStatus: "known",
    extraction: "text",
    status: "extracted",
  });
  assert.equal(acceptGuidelineSearch("Клинические рекомендации Минздрава по липидам, 2023. Источник называет порог 1.4 ммоль/л для отдельной группы. В бланке записан ЛПНП 4.8 ммоль/л."), true);
  assert.equal(acceptGuidelineSearch("Ваш диагноз: гиперхолестеринемия. Принимайте аторвастатин."), false);
});
