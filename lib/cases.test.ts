import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { describeAxes } from "./catalog";
import { guidelinesFor } from "./guidelines";
import { ingestFile } from "./ingest";
import { buildReport } from "./report";
import { emptyState, type OwnerState } from "./types";

const root = path.join(process.cwd(), "fixtures", "cases");

async function load(names: string[], region: OwnerState["region"] = "RU"): Promise<OwnerState> {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-"));
  const state = emptyState();
  state.region = region;
  try {
    for (const name of names) {
      await ingestFile(state, dir, name, await readFile(path.join(root, name)));
    }
    return state;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("simple blank extracts facts and stays a reference", async () => {
  const state = await load(["simple.txt"]);
  const report = buildReport(state);
  assert.equal(state.facts.some((fact) => fact.concept === "HGB" && fact.value === 140), true);
  assert.equal(state.facts.some((fact) => fact.concept === "GLU"), true);
  assert.equal(report.status, "ready");
  assert.equal(report.conflicts.length, 0);
  assert.doesNotMatch(JSON.stringify(report), /сдайте|назначьте|диагноз\s*:/i);
});

test("one marker across years is a change, not a diagnosis", async () => {
  const state = await load(["ldl-2019.txt", "ldl-2024.txt"]);
  const report = buildReport(state);
  assert.match(report.changes.map((item) => item.body).join("\n"), /снизилось/);
  assert.doesNotMatch(report.changes.map((item) => item.body).join("\n"), /диагноз/);
});

test("different doses on different dates are a change", async () => {
  const state = await load(["dose-a.txt", "dose-b.txt"]);
  const report = buildReport(state);
  assert.match(report.changes.map((item) => item.body).join("\n"), /смена записи во времени/);
  assert.doesNotMatch(report.conflicts.map((item) => item.title).join("\n"), /Разные дозы/);
  assert.doesNotMatch(JSON.stringify(report), /принимайте|назначьте/i);
});

test("two doses in one document stay a conflict", async () => {
  const state = await load(["dose-same.txt"]);
  const report = buildReport(state);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /одной дате или к одному документу/);
});

test("same month links a drug and a lab value without a cause", async () => {
  const state = await load(["simple.txt", "dose-b.txt"]);
  const report = buildReport(state);
  assert.match(report.relationships.map((item) => item.body).join("\n"), /тот же период/);
  assert.match(report.themes.map((item) => item.body).join("\n"), /В документе:/);
  assert.doesNotMatch(report.relationships.map((item) => item.body).join("\n"), /вызвал/);
  assert.match(report.gaps.join("\n"), /Ось «Давление»/);
});

test("table and conclusion disagreement is shown", async () => {
  const state = await load(["conclusion.txt"]);
  const report = buildReport(state);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /референс этого же бланка/);
  assert.match(JSON.stringify(report), /108/);
});

test("guideline target is stored and is not copied into the report", async () => {
  const state = await load(["ldl-2024.txt"], "EU");
  const report = buildReport(state);
  const target = guidelinesFor("EU").flatMap((item) => item.targets ?? []).find((item) => item.value === 1.8);
  assert.ok(target);
  assert.equal(target?.population.includes("very-high"), true);
  assert.doesNotMatch(JSON.stringify(report), /1\.8/);
  assert.match(report.guidelineNote, /актуальной не считается/);
  assert.match(report.guidelineNote, /версия 2025/);
});

test("older guideline is not called current", async () => {
  const state = await load(["simple.txt"], "EU");
  const report = buildReport(state);
  assert.doesNotMatch(report.guidelineNote, /актуальн\p{L}*\s+верси\p{L}*\s+2019/iu);
});

test("image is kept out and the imaging axis stays incomplete", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-img-"));
  const state = emptyState();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  try {
    await ingestFile(state, dir, "scan.png", png);
    await ingestFile(state, dir, "phone.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "phone");
    await ingestFile(state, dir, "simple.txt", await readFile(path.join(root, "simple.txt")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const report = buildReport(state);
  const imaging = describeAxes(state).find((axis) => axis.id === "imaging");
  assert.equal(state.documents.find((item) => item.fileName === "scan.png")?.status, "anonymization_unconfirmed");
  assert.match(state.documents.find((item) => item.fileName === "scan.png")?.note ?? "", /Готовый снимок/);
  assert.match(state.documents.find((item) => item.fileName === "phone.jpg")?.note ?? "", /смартфона/);
  assert.equal(imaging?.status, "insufficient_data");
  assert.match(report.headline, /2 снимка/);
  assert.match(report.cannotSay.join(" "), /снимку нельзя назвать измерения/);
  assert.match(report.gaps.join(" "), /нет давления/);
});

test("a long jpeg name keeps its type", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-long-"));
  const state = emptyState();
  const longName = `0-02-05-${"a".repeat(64)}_21f3791.jpg`;
  try {
    await ingestFile(state, dir, longName, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await ingestFile(state, dir, "photo-without-extension", Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.match(state.documents[0]?.fileName ?? "", /\.jpg$/);
  assert.equal(state.documents[0]?.status, "anonymization_unconfirmed");
  assert.match(state.documents[1]?.fileName ?? "", /\.jpg$/);
  assert.doesNotMatch(state.documents.map((item) => item.note).join(" "), /проверку типа/);
});

test("prompt injection does not become a diagnosis", async () => {
  const state = await load(["injection.txt"]);
  const report = buildReport(state);
  assert.equal(state.issues.length > 0, true);
  assert.doesNotMatch(JSON.stringify(report), /диабет|диагноз\s*:/i);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /инструкцию системе/);
});
