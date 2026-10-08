import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { renderDicomFrames, selectFrameIndices, windowPixel } from "./dicom-pixels";
import { ingestFile } from "./ingest";
import { emptyState } from "./types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function element(group: number, id: number, vr: string, input: Buffer, big = false): Buffer {
  const data = input.length % 2 ? Buffer.concat([input, Buffer.from(vr === "UI" ? [0] : [32])]) : input;
  const long = ["OW", "OB"].includes(vr);
  const header = Buffer.alloc(long ? 12 : 8);
  if (big) { header.writeUInt16BE(group, 0); header.writeUInt16BE(id, 2); } else { header.writeUInt16LE(group, 0); header.writeUInt16LE(id, 2); }
  header.write(vr, 4);
  if (long) big ? header.writeUInt32BE(data.length, 8) : header.writeUInt32LE(data.length, 8);
  else big ? header.writeUInt16BE(data.length, 6) : header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}
function u16(n: number, big = false) { const b = Buffer.alloc(2); big ? b.writeUInt16BE(n) : b.writeUInt16LE(n); return b; }
export function dicomFixture(options: { big?: boolean; signed?: boolean; mono1?: boolean; frames?: number; burned?: string; stored?: number; samples?: number; syntax?: string } = {}): Buffer {
  const big = options.big ?? false;
  const syntax = options.syntax ?? (big ? "1.2.840.10008.1.2.2" : "1.2.840.10008.1.2.1");
  const meta = element(2, 0x10, "UI", Buffer.from(syntax));
  const length = Buffer.alloc(4); length.writeUInt32LE(meta.length);
  const pre = Buffer.alloc(132); pre.write("DICM", 128);
  const frames = options.frames ?? 1;
  const samples = options.samples ?? 1;
  const pixels = Buffer.alloc(4 * frames * samples * 2);
  for (let i = 0; i < 4 * frames * samples; i++) {
    const value = options.signed ? [-100, 0, 100, 200][i % 4]! : [0, 85, 170, 255][i % 4]!;
    const raw = value < 0 ? 2 ** (options.stored ?? 16) + value : value;
    big ? pixels.writeUInt16BE(raw, i * 2) : pixels.writeUInt16LE(raw, i * 2);
  }
  const tag = (g: number, id: number, vr: string, b: Buffer) => element(g, id, vr, b, big);
  return Buffer.concat([pre, element(2, 0, "UL", length), meta,
    tag(8, 0x20, "DA", Buffer.from("20240101")), tag(8, 0x60, "CS", Buffer.from("CT")),
    tag(0x10, 0x10, "PN", Buffer.from("PRIVATE^PERSON")),
    tag(0x28, 2, "US", u16(samples, big)), tag(0x28, 4, "CS", Buffer.from(options.mono1 ? "MONOCHROME1" : "MONOCHROME2")),
    tag(0x28, 8, "IS", Buffer.from(String(frames))),
    tag(0x28, 0x10, "US", u16(2, big)), tag(0x28, 0x11, "US", u16(2, big)),
    tag(0x28, 0x100, "US", u16(16, big)), tag(0x28, 0x101, "US", u16(options.stored ?? 16, big)), tag(0x28, 0x102, "US", u16((options.stored ?? 16) - 1, big)), tag(0x28, 0x103, "US", u16(options.signed ? 1 : 0, big)),
    ...(options.burned ? [tag(0x28, 0x301, "CS", Buffer.from(options.burned))] : []),
    tag(0x7fe0, 0x10, "OW", pixels),
  ]);
}

test("DICOM windows match LINEAR boundary and threshold behaviour", () => {
  assert.equal(windowPixel(-50, 0, 100), 0);
  assert.equal(windowPixel(49, 0, 100), 255);
  assert.equal(windowPixel(-1, 0, 1), 0);
  assert.equal(windowPixel(0, 0, 1), 255);
  assert.equal(windowPixel(0, 0, 1, true), 0);
  assert.throws(() => windowPixel(0, 0, 0));
});

test("little and big endian, signed and unsigned native pixels render without identifiers", async () => {
  for (const options of [{}, { big: true }, { signed: true }, { signed: true, stored: 12 }, { mono1: true }]) {
    const result = await renderDicomFrames(dicomFixture(options));
    assert.equal(result.frames.length, 1);
    const decoded = await sharp(result.frames[0]!.png).greyscale().raw().toBuffer();
    assert.equal(decoded.length, 4);
    assert.equal(decoded[0], "mono1" in options ? 255 : 0);
    assert.equal(decoded[3], "mono1" in options ? 0 : 255);
    assert.equal(result.frames[0]!.png.includes(Buffer.from("PRIVATE")), false);
    assert.equal(result.canSend, false);
  }
});

test("multiframe selection states partial coverage and includes endpoints", async () => {
  assert.deepEqual(selectFrameIndices(3), [0, 1, 2]);
  assert.throws(() => selectFrameIndices(0));
  const result = await renderDicomFrames(dicomFixture({ frames: 20, burned: "NO" }));
  assert.equal(result.frames.length, 12);
  assert.equal(result.frames[0]!.index, 0);
  assert.equal(result.frames.at(-1)!.index, 19);
  assert.equal(result.coverage, "sampled");
  assert.equal(result.canSend, true);
  assert.match(result.limitations.join(" "), /не вся серия/);
});

test("unsupported compression and truncated data never produce plausible frames", async () => {
  await assert.rejects(renderDicomFrames(dicomFixture({ syntax: "1.2.840.10008.1.2.4.90" })), /Сжатие/);
  await assert.rejects(renderDicomFrames(dicomFixture().subarray(0, -2)));
});

test("DICOM ingestion extracts real pixels locally without a model key", async () => {
  const previous = [process.env.OPENROUTER_API_KEY, process.env.POLZA_AI_API_KEY, process.env.POLZA_API_KEY];
  delete process.env.OPENROUTER_API_KEY; delete process.env.POLZA_AI_API_KEY; delete process.env.POLZA_API_KEY;
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-dicom-"));
  try {
    const state = emptyState();
    const doc = await ingestFile(state, dir, "study.dcm", dicomFixture());
    assert.equal(doc.status, "ready");
    assert.equal(doc.visualAnalysis?.totalFrames, 1);
    assert.equal(doc.visualAnalysis?.status, "unavailable");
    assert.deepEqual(doc.visualAnalysis?.findings, []);
    assert.doesNotMatch(doc.anonymizedText, /PRIVATE/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    ["OPENROUTER_API_KEY", "POLZA_AI_API_KEY", "POLZA_API_KEY"].forEach((key, i) => { if (previous[i] !== undefined) process.env[key] = previous[i]; });
  }
});

test("prepared DICOM frames, not the original file, reach the visual model", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "mock-key-not-sent";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    const images = request.messages[0].content.filter((part: { type: string }) => part.type === "image_url");
    assert.equal(images.length, 1);
    assert.match(images[0].image_url.url, /^data:image\/png;base64,/);
    const png = Buffer.from(images[0].image_url.url.split(",")[1], "base64");
    assert.equal(png.includes(Buffer.from("PRIVATE")), false);
    assert.notEqual(png.subarray(128, 132).toString(), "DICM");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ studyDate: "", lines: [], measurements: [], medications: [], visualFindings: [{ description: "Предварительный видимый признак", region: "кадр", confidence: "moderate", frame: 0 }] }) } }] });
  };
  const dir = await mkdtemp(path.join(tmpdir(), "atlaxis-vision-"));
  try {
    const state = emptyState();
    const doc = await ingestFile(state, dir, "study.dcm", dicomFixture({ burned: "NO" }));
    assert.equal(calls, 1);
    assert.equal(doc.visualAnalysis?.status, "ready");
    assert.equal(doc.visualAnalysis?.findings.length, 1);
    assert.equal(state.facts.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    await rm(dir, { recursive: true, force: true });
  }
});
