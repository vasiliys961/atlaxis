import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { describeAxes } from "./catalog";
import { guidelinesFor, targetMark } from "./guidelines";
import { ingestFile, stageFile } from "./ingest";
import { completeJob, enqueueDocument, prepareJob } from "./queue";
import { buildReport } from "./report";
import { emptyState, type OwnerState } from "./types";

const root = path.join(process.cwd(), "fixtures", "cases");
const exec = promisify(execFile);

async function wordFile(dir: string): Promise<Buffer> {
  const pack = path.join(dir, "pack");
  await mkdir(path.join(pack, "_rels"), { recursive: true });
  await mkdir(path.join(pack, "word"), { recursive: true });
  await writeFile(path.join(pack, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  await writeFile(path.join(pack, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  await writeFile(path.join(pack, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Дата исследования: 2024-03-12</w:t></w:r></w:p>
    <w:p><w:r><w:t>Гемоглобин 108 г/л 120-160</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  const out = path.join(dir, "blank.docx");
  await exec("zip", ["-qr", out, "[Content_Types].xml", "_rels", "word"], { cwd: pack });
  return readFile(out);
}

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

test("a file can sit in the queue before it is read", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-"));
  const state = emptyState();
  try {
    const bytes = await readFile(path.join(root, "simple.txt"));
    const staged = await stageFile(state, dir, "simple.txt", bytes);
    assert.equal(staged.status, "queued");
    assert.equal(staged.statusLabel, "Проверяется");
    assert.equal(state.facts.length, 0);
    enqueueDocument(state, staged.id, staged.fileName);
    const prepared = await prepareJob(state, dir);
    assert.equal(prepared.kind, "ready");
    assert.equal(staged.statusLabel, "Разбирается");
    if (prepared.kind === "ready") await completeJob(state, prepared);
    assert.equal(staged.status, "ready");
    assert.equal(state.jobs[0]?.status, "done");
    assert.equal(state.facts.some((fact) => fact.concept === "HGB" && fact.value === 140), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("simple blank extracts facts and stays a reference", async () => {
  const state = await load(["simple.txt"]);
  const report = buildReport(state);
  assert.equal(state.facts.some((fact) => fact.concept === "HGB" && fact.value === 140 && fact.status === "extracted" && fact.dateStatus === "known"), true);
  assert.equal(state.facts.some((fact) => fact.concept === "GLU"), true);
  assert.equal(report.status, "ready");
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.catalog?.every((item) => item.origin === "offered"), true);
  assert.equal(report.catalog?.some((item) => item.place === "Европа" && item.version === "2025"), true);
  assert.equal(report.catalog?.some((item) => item.place === "США" && item.version === "2026"), true);
  assert.equal(report.catalog?.some((item) => item.version === "2018" || item.version === "2019"), false);
  assert.match(report.guidelineNote, /европейские и американские/);
  assert.match(report.guidelineNote, /Пометка/);
  const offered = report.catalog?.find((item) => item.version === "2025");
  assert.equal(offered?.targetValue, "1.8");
  assert.match(offered ? targetMark(offered) : "", /не личная цель — 1\.8 ммоль\/л/);
  assert.doesNotMatch(report.themes.map((item) => item.body).join("\n"), /1\.8/);
  assert.doesNotMatch(JSON.stringify(report), /сдайте|назначьте|диагноз\s*:/i);
});

test("one marker across years is a change, not a diagnosis", async () => {
  const state = await load(["ldl-2019.txt", "ldl-2024.txt"]);
  const report = buildReport(state);
  assert.match(report.changes.map((item) => item.body).join("\n"), /4\.2 ммоль\/л.*затем 3\.4 ммоль\/л/);
  assert.match(report.changes.map((item) => item.body).join("\n"), /причина изменения по этим данным не устанавливается/);
  assert.doesNotMatch(report.changes.map((item) => item.body).join("\n"), /диагноз/);
});

test("different doses on different dates are a change", async () => {
  const state = await load(["dose-a.txt", "dose-b.txt"]);
  const report = buildReport(state);
  assert.match(report.changes.map((item) => item.body).join("\n"), /смена записи во времени/);
  assert.equal(report.timeline?.[0]?.date, "2023-01-01");
  assert.equal(report.timeline?.[1]?.date, "2024-01-01");
  assert.match(report.timeline?.map((item) => item.text).join("\n") ?? "", /В тексте: аторвастатин 10 мг/);
  assert.doesNotMatch(report.timeline?.map((item) => item.text).join("\n") ?? "", /вызвал|назначьте/);
  assert.doesNotMatch(report.conflicts.map((item) => item.title).join("\n"), /Разные дозы/);
  assert.doesNotMatch(JSON.stringify(report), /принимайте|назначьте/i);
});

test("two doses in one document stay a conflict", async () => {
  const state = await load(["dose-same.txt"]);
  const report = buildReport(state);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /одной дате или к одному документу/);
});

test("same month does not imply a clinical relationship between drug and lab", async () => {
  const state = await load(["simple.txt", "dose-b.txt"]);
  const report = buildReport(state);
  assert.equal(report.relationships.length, 0);
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

test("guideline target is shown with a mark and stays out of the lab lines", async () => {
  const state = await load(["ldl-2024.txt"], "EU");
  const report = buildReport(state);
  const target = guidelinesFor("EU").flatMap((item) => item.targets ?? []).find((item) => item.value === 1.8);
  assert.ok(target);
  assert.equal(target?.population.includes("very-high"), true);
  const current = report.catalog?.find((item) => item.version === "2025");
  assert.equal(current?.standing, "current");
  assert.equal(current?.origin, "selected");
  assert.equal(current?.targetValue, "1.8");
  assert.equal(current?.targetUnit, "ммоль/л");
  assert.match(current ? targetMark(current) : "", /не личная цель/);
  assert.equal(report.catalog?.some((item) => item.version === "2018" || item.version === "2019"), false);
  assert.doesNotMatch([...report.themes, ...report.changes, ...report.conflicts].map((item) => item.body).join("\n"), /1\.8/);
  assert.match(report.guidelineNote, /Пометка/);
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

test("a word file is read as text", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-docx-"));
  const state = emptyState();
  try {
    const bytes = await wordFile(dir);
    await ingestFile(state, dir, "бланк.docx", bytes);
    const legacy = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(64)]);
    await ingestFile(state, dir, "old.doc", legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const ready = state.documents.find((item) => item.fileName.endsWith(".docx"));
  assert.equal(ready?.status, "ready");
  assert.equal(state.facts.some((item) => item.concept === "HGB" && item.value === 108), true);
  assert.match(state.documents.find((item) => item.fileName.endsWith(".doc"))?.note ?? "", /\.docx/);
});

test("an iphone heic photo is stored as jpeg", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-heic-"));
  const state = emptyState();
  try {
    const heic = await readFile(path.join(process.cwd(), "fixtures", "iphone.heic"));
    await ingestFile(state, dir, "IMG_0001.HEIC", heic);
    await ingestFile(state, dir, "already.heic", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const broken = Buffer.alloc(24);
    broken.write("ftyp", 4, "ascii");
    broken.write("heic", 8, "ascii");
    await ingestFile(state, dir, "broken.HEIC", broken);
    const stored = state.documents.find((item) => item.fileName === "IMG_0001.jpg");
    assert.ok(stored);
    assert.equal(stored?.status === "failed", false);
    const bin = await readFile(path.join(dir, `${stored?.id}.bin`));
    assert.equal(bin[0], 0xff);
    assert.equal(bin[1], 0xd8);
    assert.equal(state.documents.find((item) => item.fileName === "already.jpg")?.status, "anonymization_unconfirmed");
    assert.match(state.documents.find((item) => item.fileName === "broken.heic")?.note ?? "", /JPEG/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prompt injection does not become a diagnosis", async () => {
  const state = await load(["injection.txt"]);
  const report = buildReport(state);
  assert.equal(state.issues.length > 0, true);
  assert.doesNotMatch(JSON.stringify(report), /диабет|диагноз\s*:/i);
  assert.match(report.conflicts.map((item) => item.body).join("\n"), /инструкцию системе/);
});
