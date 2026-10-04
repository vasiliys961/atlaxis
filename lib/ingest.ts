import { readFile, writeFile } from "fs/promises";
import path from "path";
import { writeBinary } from "./files";
import { anonymizeText } from "./anonymize";
import { extractDocxText, looksLikeDocx, looksLikeLegacyDoc } from "./docx";
import { heicToJpeg, isHeicContainer, jpegName } from "./heic";
import { scrubReading } from "./image-json";
import { extractPdfText } from "./pdf";
import { decideProcessing } from "./policy";
import { polzaKey, readImageJson } from "./polza";
import { contentHash, newId, parseDocument } from "./parse";
import { PIPELINE_VERSION, type MedicalDocument, type OwnerState } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;

const TEXT_EXT = new Set(["txt", "csv", "md"]);
const WORD_EXT = new Set(["docx"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);
const KEEP_EXT = new Set(["pdf", "dcm", "dicom"]);
const HEIC_EXT = new Set(["heic", "heif"]);

function extension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function sniffExt(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if ((bytes.length >= 132 && bytes.subarray(128, 132).toString("ascii") === "DICM") || bytes.subarray(0, 4).toString("ascii") === "DICM") return "dcm";
  if (looksLikeDocx(bytes)) return "docx";
  return "";
}

function looksLike(bytes: Buffer, ext: string): boolean {
  if (TEXT_EXT.has(ext)) return !bytes.subarray(0, 800).includes(0);
  if (ext === "png") return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (ext === "jpg" || ext === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (ext === "webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF";
  if (ext === "pdf") return bytes.subarray(0, 4).toString("ascii") === "%PDF";
  if (ext === "docx") return looksLikeDocx(bytes);
  if (ext === "dcm" || ext === "dicom") return bytes.subarray(128, 132).toString("ascii") === "DICM" || bytes.subarray(0, 4).toString("ascii") === "DICM";
  return false;
}

function safeName(fileName: string): string {
  const raw = path.basename(fileName);
  const dot = raw.lastIndexOf(".");
  const hasExt = dot > 0 && dot < raw.length - 1;
  const ext = hasExt ? raw.slice(dot + 1).replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 8) : "";
  const stem = (hasExt ? raw.slice(0, dot) : raw).replace(/[^\w.\-а-яё ]+/gi, "_").replace(/^\.+/, "");
  const suffix = ext ? `.${ext}` : "";
  const name = `${stem.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
  return name.replace(/^\.+/, "") || "document";
}

function refused(state: OwnerState, name: string, payload: Buffer, note: string, base?: Omit<MedicalDocument, "status" | "statusLabel" | "note">): MedicalDocument {
  const failed: MedicalDocument = {
    id: base?.id ?? newId(),
    fileName: base?.fileName ?? name,
    byteSize: base?.byteSize ?? payload.length,
    contentHash: base?.contentHash ?? contentHash(payload),
    pipelineVersion: PIPELINE_VERSION,
    studyDate: null,
    anonymizedText: "",
    createdAt: base?.createdAt ?? new Date().toISOString(),
    status: "failed",
    statusLabel: "Не удалось разобрать",
    note,
  };
  state.documents.push(failed);
  return failed;
}

function dropDerivatives(state: OwnerState, documentId: string): void {
  state.facts = state.facts.filter((item) => item.documentId !== documentId);
  state.medications = state.medications.filter((item) => item.documentId !== documentId);
  state.issues = state.issues.filter((item) => item.documentId !== documentId);
}

export async function stageFile(
  state: OwnerState,
  dir: string,
  fileName: string,
  bytes: Buffer,
): Promise<MedicalDocument> {
  return acceptFile(state, dir, fileName, bytes);
}

export async function ingestFile(
  state: OwnerState,
  dir: string,
  fileName: string,
  bytes: Buffer,
  origin: "phone" | "computer" = "computer",
): Promise<MedicalDocument> {
  const document = await acceptFile(state, dir, fileName, bytes);
  if (document.status !== "queued") return document;
  const stored = await readFile(path.join(dir, `${document.id}.bin`));
  return settleDocument(state, document, stored, origin);
}

async function acceptFile(
  state: OwnerState,
  dir: string,
  fileName: string,
  bytes: Buffer,
): Promise<MedicalDocument> {
  let name = safeName(fileName);
  let payload = bytes;
  if (isHeicContainer(payload)) {
    try {
      payload = await heicToJpeg(payload);
      name = jpegName(name);
    } catch {
      const failed = refused(state, name, payload, "Снимок HEIC не удалось перевести в JPEG. В разбор он не вошёл.");
      return failed;
    }
  } else if (HEIC_EXT.has(extension(name)) && payload[0] === 0xff && payload[1] === 0xd8) {
    name = jpegName(name);
  }
  const hash = contentHash(payload);
  const existing = state.documents.find((item) => item.contentHash === hash && item.pipelineVersion === PIPELINE_VERSION);
  if (existing) return existing;

  let ext = extension(name);
  if (!TEXT_EXT.has(ext) && !WORD_EXT.has(ext) && !IMAGE_EXT.has(ext) && !KEEP_EXT.has(ext)) {
    const sniffed = sniffExt(payload);
    if (sniffed) {
      ext = sniffed;
      if (!name.toLowerCase().endsWith(`.${sniffed}`)) {
        name = `${name.slice(0, Math.max(1, 80 - sniffed.length - 1))}.${sniffed}`;
      }
    }
  }
  const id = newId();
  const allowed = TEXT_EXT.has(ext) || WORD_EXT.has(ext) || IMAGE_EXT.has(ext) || KEEP_EXT.has(ext);
  const base = {
    id,
    fileName: name,
    byteSize: payload.length,
    contentHash: hash,
    pipelineVersion: PIPELINE_VERSION,
    studyDate: null,
    anonymizedText: "",
    createdAt: new Date().toISOString(),
  };

  if (!allowed || payload.length === 0 || payload.length > MAX_BYTES || !looksLike(payload, ext)) {
    const note = looksLikeLegacyDoc(payload)
      ? "Старый файл Word .doc не читается. Сохраните его как .docx — тогда текст войдёт в разбор."
      : "Файл не прошёл проверку типа или размера и в разбор не вошёл.";
    return refused(state, name, payload, note, base);
  }

  await writeFile(path.join(dir, `${id}.bin`), payload);
  await writeBinary(`${path.basename(dir)}/${id}.bin`, payload);
  const queued: MedicalDocument = {
    ...base,
    status: "queued",
    statusLabel: "Проверяется",
    note: "Файл принят и ждёт чтения.",
  };
  state.documents.push(queued);
  return queued;
}

export async function settleDocument(
  state: OwnerState,
  document: MedicalDocument,
  bytes: Buffer,
  origin: "phone" | "computer" = "computer",
): Promise<MedicalDocument> {
  if (document.status !== "queued") return document;
  const id = document.id;
  const ext = extension(document.fileName) || sniffExt(bytes);
  dropDerivatives(state, id);

  if (IMAGE_EXT.has(ext) || ext === "dcm" || ext === "dicom") {
    if (IMAGE_EXT.has(ext)) {
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      try {
        const reading = await readImageJson(bytes, mime);
        if (reading) {
          const scrubbed = scrubReading(reading);
          if (!scrubbed.leaked) {
            const parsed = parseDocument(scrubbed.lines);
            document.status = "ready";
            document.statusLabel = "Готово";
            document.note = scrubbed.lines.trim()
              ? "Снимок прочитан. В разбор попали только строки, которые совпали со словарём показателей."
              : "На снимке не нашлось видимого текста. Числа с него в разбор не вошли.";
            document.studyDate = parsed.studyDate;
            document.anonymizedText = scrubbed.json;
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
    const eyes = decideProcessing({
      operation: "read_image",
      kind: picture ? "image" : "dicom",
      bytes: bytes.length,
      hasKey: Boolean(polzaKey()),
    });
    document.status = "anonymization_unconfirmed";
    document.statusLabel = "Снимок сохранён отдельно";
    document.note = picture
      ? eyes.allow
        ? "Снимок отправлен на чтение, но показатели из ответа не приняты. В разбор они не вошли."
        : polzaKey()
          ? eyes.reason
          : origin === "phone"
            ? "Снимок со смартфона сохранён. Текст на изображении не проверяется, поэтому измерения с него не читаются."
            : "Готовый снимок сохранён. Текст на изображении не проверяется, поэтому измерения с него не читаются."
      : eyes.reason;
    state.report = null;
    return document;
  }

  let decoded = "";
  if (ext === "pdf") {
    try {
      decoded = await extractPdfText(bytes);
    } catch {
      decoded = "";
    }
    if (!decoded.trim()) {
      document.status = "anonymization_unconfirmed";
      document.statusLabel = "PDF сохранён отдельно";
      document.note = "В файле не нашлось текстового слоя. Строки не выдуманы, в разбор он не вошёл.";
      state.report = null;
      return document;
    }
  } else if (ext === "docx") {
    try {
      decoded = await extractDocxText(bytes);
    } catch {
      decoded = "";
    }
    if (!decoded.trim()) {
      document.status = "anonymization_unconfirmed";
      document.statusLabel = "Word сохранён отдельно";
      document.note = "В файле Word не нашлось текста. Строки не выдуманы, в разбор он не вошёл.";
      state.report = null;
      return document;
    }
  } else {
    decoded = bytes.toString("utf8");
  }

  const anonymized = anonymizeText(decoded);
  if (anonymized.leaked) {
    document.status = "failed";
    document.statusLabel = "Не удалось разобрать";
    document.note = "После удаления персональных данных в тексте остались контакт или документ. Файл в разбор не вошёл.";
    return document;
  }

  const parsed = parseDocument(anonymized.text);
  document.status = "ready";
  document.statusLabel = "Готово";
  document.note = parsed.facts.length > 0 ? "Текст прочитан, персональные данные в нём скрыты." : "Текст прочитан. Измерений в нём не найдено.";
  document.studyDate = parsed.studyDate;
  document.anonymizedText = anonymized.text;
  for (const fact of parsed.facts) state.facts.push({ ...fact, id: newId(), documentId: id });
  for (const medication of parsed.medications) state.medications.push({ ...medication, id: newId(), documentId: id });
  for (const issue of parsed.issues) state.issues.push({ ...issue, id: newId(), documentId: id });
  state.report = null;
  return document;
}
