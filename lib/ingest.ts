import { writeFile } from "fs/promises";
import path from "path";
import { anonymizeText } from "./anonymize";
import { scrubReading } from "./image-json";
import { extractPdfText } from "./pdf";
import { readImageJson } from "./polza";
import { contentHash, newId, parseDocument } from "./parse";
import { PIPELINE_VERSION, type MedicalDocument, type OwnerState } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;

const TEXT_EXT = new Set(["txt", "csv", "md"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);
const KEEP_EXT = new Set(["pdf", "dcm", "dicom"]);

function extension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function looksLike(bytes: Buffer, ext: string): boolean {
  if (TEXT_EXT.has(ext)) return !bytes.subarray(0, 800).includes(0);
  if (ext === "png") return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (ext === "jpg" || ext === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (ext === "webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF";
  if (ext === "pdf") return bytes.subarray(0, 4).toString("ascii") === "%PDF";
  if (ext === "dcm" || ext === "dicom") return bytes.subarray(128, 132).toString("ascii") === "DICM" || bytes.subarray(0, 4).toString("ascii") === "DICM";
  return false;
}

function safeName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^\w.\-а-яё ]+/gi, "_").slice(0, 80);
  return base || "document";
}

export async function ingestFile(
  state: OwnerState,
  dir: string,
  fileName: string,
  bytes: Buffer,
  origin: "phone" | "computer" = "computer",
): Promise<MedicalDocument> {
  const name = safeName(fileName);
  const hash = contentHash(bytes);
  const existing = state.documents.find((item) => item.contentHash === hash && item.pipelineVersion === PIPELINE_VERSION);
  if (existing) return existing;

  const ext = extension(name);
  const id = newId();
  const allowed = TEXT_EXT.has(ext) || IMAGE_EXT.has(ext) || KEEP_EXT.has(ext);
  const base = {
    id,
    fileName: name,
    byteSize: bytes.length,
    contentHash: hash,
    pipelineVersion: PIPELINE_VERSION,
    studyDate: null,
    anonymizedText: "",
    createdAt: new Date().toISOString(),
  };

  if (!allowed || bytes.length === 0 || bytes.length > MAX_BYTES || !looksLike(bytes, ext)) {
    const failed: MedicalDocument = {
      ...base,
      status: "failed",
      statusLabel: "Не удалось разобрать",
      note: "Файл не прошёл проверку типа или размера и в разбор не вошёл.",
    };
    state.documents.push(failed);
    return failed;
  }

  await writeFile(path.join(dir, `${id}.bin`), bytes);

  if (IMAGE_EXT.has(ext) || ext === "dcm" || ext === "dicom") {
    if (IMAGE_EXT.has(ext)) {
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      try {
        const reading = await readImageJson(bytes, mime);
        if (reading) {
          const scrubbed = scrubReading(reading);
          if (!scrubbed.leaked) {
            const parsed = parseDocument(scrubbed.lines);
            const document: MedicalDocument = {
              ...base,
              status: "ready",
              statusLabel: "Готово",
              note: scrubbed.lines.trim()
                ? "Gemini 3.8 записала снимок в JSON. В разбор попали только строки, которые совпали со словарём показателей."
                : "Gemini 3.8 вернула пустой JSON: видимого текста на снимке не нашлось.",
              studyDate: parsed.studyDate,
              anonymizedText: scrubbed.json,
            };
            state.documents.push(document);
            for (const fact of parsed.facts) state.facts.push({ ...fact, id: newId(), documentId: id });
            for (const medication of parsed.medications) state.medications.push({ ...medication, id: newId(), documentId: id });
            for (const issue of parsed.issues) state.issues.push({ ...issue, id: newId(), documentId: id });
            state.report = null;
            return document;
          }
        }
      } catch {
        // Снимок остаётся в списке без измерений, если JSON не получен.
      }
    }
    const picture = IMAGE_EXT.has(ext);
    const held: MedicalDocument = {
      ...base,
      status: "anonymization_unconfirmed",
      statusLabel: "Снимок сохранён отдельно",
      note: picture
        ? origin === "phone"
          ? "Снимок со смартфона сохранён. Текст на изображении не проверяется, поэтому измерения с него не читаются."
          : "Готовый снимок сохранён. Текст на изображении не проверяется, поэтому измерения с него не читаются."
        : "Текст на изображении здесь не проверяется, поэтому измерения с него не читаются.",
    };
    state.documents.push(held);
    state.report = null;
    return held;
  }

  let decoded = "";
  if (ext === "pdf") {
    try {
      decoded = await extractPdfText(bytes);
    } catch {
      decoded = "";
    }
    if (!decoded.trim()) {
      const held: MedicalDocument = {
        ...base,
        status: "anonymization_unconfirmed",
        statusLabel: "PDF сохранён отдельно",
        note: "В файле не нашлось текстового слоя. Строки не выдуманы, в разбор он не вошёл.",
      };
      state.documents.push(held);
      state.report = null;
      return held;
    }
  } else {
    decoded = bytes.toString("utf8");
  }

  const anonymized = anonymizeText(decoded);
  if (anonymized.leaked) {
    const failed: MedicalDocument = {
      ...base,
      status: "failed",
      statusLabel: "Не удалось разобрать",
      note: "После удаления персональных данных в тексте остались контакт или документ. Файл в разбор не вошёл.",
    };
    state.documents.push(failed);
    return failed;
  }

  const parsed = parseDocument(anonymized.text);
  const document: MedicalDocument = {
    ...base,
    status: "ready",
    statusLabel: "Готово",
    note: parsed.facts.length > 0 ? "Текст прочитан, персональные данные в нём скрыты." : "Текст прочитан. Измерений в нём не найдено.",
    studyDate: parsed.studyDate,
    anonymizedText: anonymized.text,
  };
  state.documents.push(document);
  for (const fact of parsed.facts) state.facts.push({ ...fact, id: newId(), documentId: id });
  for (const medication of parsed.medications) state.medications.push({ ...medication, id: newId(), documentId: id });
  for (const issue of parsed.issues) state.issues.push({ ...issue, id: newId(), documentId: id });
  state.report = null;
  return document;
}
