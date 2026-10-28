import { readFile, writeFile } from "fs/promises";
import path from "path";
import { writeBinary } from "./files";
import { anonymizeText } from "./anonymize";
import { extractDocxText, looksLikeDocx, looksLikeLegacyDoc } from "./docx";
import { heicToJpeg, isHeicContainer, jpegName } from "./heic";
import { reconcileLabReading } from "./lab-reading";
import { mergeReadings, scrubReading, type ImageReading } from "./image-json";
import { extractPdfText } from "./pdf";
import { renderPdfPages } from "./pdf-pages";
import { extractSpreadsheet } from "./spreadsheet";
import { extractDicom } from "./dicom";
import { renderDicomFrames } from "./dicom-pixels";
import { decideProcessing } from "./policy";
import { polzaKey, readImageFrames, readImageJson } from "./polza";
import { contentHash, newId, parseDocument } from "./parse";
import { PIPELINE_VERSION, type MedicalDocument, type OwnerState } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;

const TEXT_EXT = new Set(["txt", "csv", "md"]);
const WORD_EXT = new Set(["docx", "xls", "xlsx"]);
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
  if (ext === "xls" || ext === "xlsx") return bytes.length > 4;
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

const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

function dropDerivatives(state: OwnerState, documentId: string): void {
  state.facts = state.facts.filter((item) => item.documentId !== documentId);
  state.medications = state.medications.filter((item) => item.documentId !== documentId);
  state.issues = state.issues.filter((item) => item.documentId !== documentId);
}

function readingFilled(reading: ImageReading): boolean {
  return Boolean(reading.lines.length || reading.measurements.length || reading.medications.length || (reading.visualFindings?.length ?? 0) || reading.studyDate);
}

function imageReadFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "polza_failed") return "Сервис чтения снимка не ответил. Строки не выдуманы.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "Чтение снимка оборвалось по времени. Строки не выдуманы.";
  return "Снимок отправлен на чтение, но ответ не удалось разобрать. Строки не выдуманы.";
}

function imageNote(reading: ImageReading): string {
  if (!readingFilled(reading)) return "На снимке не нашлось видимого текста. Строки не выдуманы.";
  return "Прочитан весь видимый текст. В сводке — показатели словаря, остальные строки сохранены целиком. Наблюдения на снимке не подтверждают диагноз.";
}

function storeReading(state: OwnerState, document: MedicalDocument, reading: ImageReading, note: string, frames: number, visual: boolean): boolean {
  const scrubbed = scrubReading(reading);
  if (scrubbed.leaked) return false;
  const clean = JSON.parse(scrubbed.json) as ImageReading;
  const parsed = reconcileLabReading(clean);
  document.status = "ready";
  document.statusLabel = "Готово";
  document.note = note;
  document.studyDate = parsed.studyDate;
  document.anonymizedText = scrubbed.json;
  if (visual || (clean.visualFindings?.length ?? 0) > 0) {
    document.visualAnalysis = {
      status: "ready",
      totalFrames: Math.max(1, frames),
      analyzedFrames: Array.from({ length: Math.max(1, frames) }, (_, index) => index),
      coverage: "complete",
      limitations: ["Визуальные наблюдения требуют проверки специалистом и не заменяют описание врача."],
      findings: clean.visualFindings ?? [],
    };
  }
  for (const fact of parsed.facts) state.facts.push({ ...fact, id: newId(), documentId: document.id });
  for (const medication of parsed.medications) state.medications.push({ ...medication, id: newId(), documentId: document.id });
  for (const issue of parsed.issues) state.issues.push({ ...issue, id: newId(), documentId: document.id });
  state.report = null;
  return true;
}

async function readScannedPdf(bytes: Buffer): Promise<{ reading: ImageReading | null; note: string; pages: number } | null> {
  let rendered: Awaited<ReturnType<typeof renderPdfPages>>;
  try {
    rendered = await renderPdfPages(bytes);
  } catch {
    return null;
  }
  if (!rendered.pages.length) return null;
  if (!polzaKey()) {
    return { reading: null, note: "В файле нет текстового слоя. Чтение страниц не запущено: нет ключа модели.", pages: 0 };
  }
  const parts: ImageReading[] = [];
  for (let index = 0; index < rendered.pages.length; index += 2) {
    const chunk = rendered.pages.slice(index, index + 2);
    const reading = await readImageFrames(chunk).catch(() => null);
    if (!reading || !readingFilled(reading)) continue;
    parts.push(rendered.pages.length > 1 ? { ...reading, lines: [`Страница ${chunk[0]!.index + 1}`, ...reading.lines] } : reading);
  }
  if (!parts.length) {
    return { reading: null, note: "Страницы открыты, но текст из ответа не принят. Строки не выдуманы.", pages: rendered.pages.length };
  }
  const reading = mergeReadings(parts);
  const clipped = rendered.totalPages > rendered.pages.length;
  const note = clipped
    ? `Прочитаны первые ${rendered.pages.length} из ${rendered.totalPages} страниц. Весь видимый текст сохранён, сводка берёт показатели словаря.`
    : "Страницы прочитаны целиком. Весь видимый текст сохранён, сводка берёт показатели словаря.";
  return { reading, note, pages: rendered.pages.length };
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

  if (VIDEO_EXT.has(ext)) {
    return refused(state, name, payload, "Видео не отправляется файлом. В блоке «Документы одним видео» выберите кадры листов: с каждого читается весь видимый текст.", base);
  }

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
    if (ext === "dcm" || ext === "dicom") {
      try {
        const dicom = extractDicom(bytes);
        const anonymized = anonymizeText(dicom.text);
        if (anonymized.leaked) throw new Error("DICOM metadata contains identifying data");
        document.status = "ready";
        document.statusLabel = "DICOM прочитан";
        document.note = dicom.text
          ? "DICOM-метаданные прочитаны. Идентифицирующие поля не используются как клинические факты."
          : "DICOM принят, но клинического текста в метаданных не найдено.";
        document.studyDate = dicom.studyDate;
        document.anonymizedText = anonymized.text;
        try {
          const pixels = await renderDicomFrames(bytes);
          const reading = pixels.canSend && polzaKey() ? await readImageFrames(pixels.frames.map(frame => ({ bytes: frame.png, mime: "image/png", index: frame.index }))) : null;
          const scrubbed = reading ? scrubReading(reading) : null;
          const clean = scrubbed && !scrubbed.leaked ? JSON.parse(scrubbed.json) as typeof reading : null;
          document.visualAnalysis = { status: clean ? "ready" : "unavailable", totalFrames: pixels.totalFrames, analyzedFrames: clean ? pixels.frames.map(f => f.index) : [], coverage: pixels.coverage, limitations: [...pixels.limitations, ...(!polzaKey() ? ["Ключ визуальной модели не задан."] : [])], findings: clean?.visualFindings ?? [] };
          document.note = clean ? "Из DICOM извлечены пиксельные кадры и предварительные визуальные наблюдения. Они учитываются отдельно от подтверждённых записей." : "Пиксельные кадры извлечены локально; визуальная интерпретация недоступна. Причины указаны в разборе.";
        } catch (error) {
          document.visualAnalysis = { status: "unavailable", totalFrames: 0, analyzedFrames: [], coverage: "sampled", limitations: [error instanceof Error ? error.message : "Не удалось извлечь пиксели DICOM."], findings: [] };
          document.note = "DICOM-метаданные прочитаны; пиксельный анализ недоступен. Причина указана в разборе.";
        }
        state.report = null;
        return document;
      } catch {
        document.status = "anonymization_unconfirmed";
        document.statusLabel = "DICOM сохранён отдельно";
        document.note = "DICOM сохранён, но метаданные не удалось безопасно разобрать.";
        state.report = null;
        return document;
      }
    }
    if (IMAGE_EXT.has(ext)) {
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      try {
        const reading = await readImageJson(bytes, mime);
        if (reading && storeReading(state, document, reading, imageNote(reading), 1, true)) return document;
        document.status = "anonymization_unconfirmed";
        document.statusLabel = "Снимок сохранён отдельно";
        document.note = "Снимок отправлен на чтение, но в ответе не нашлось текста бланка. Строки не выдуманы.";
        state.report = null;
        return document;
      } catch (error) {
        document.status = "anonymization_unconfirmed";
        document.statusLabel = "Снимок сохранён отдельно";
        document.note = imageReadFailure(error);
        state.report = null;
        return document;
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
        ? "Ответ распознавания не принят: он отсутствует, не прошёл проверку или превышает допустимый объём. Снимок не вошёл в разбор; попробуйте отдельные страницы или более чёткие фотографии."
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
      const scanned = await readScannedPdf(bytes);
      if (scanned?.reading) {
        if (storeReading(state, document, scanned.reading, scanned.note, scanned.pages, false)) return document;
        document.status = "failed";
        document.statusLabel = "Не удалось разобрать";
        document.note = "После удаления персональных данных на страницах остались контакт или документ. Файл в разбор не вошёл.";
        state.report = null;
        return document;
      }
      document.status = "anonymization_unconfirmed";
      document.statusLabel = "PDF сохранён отдельно";
      document.note = scanned?.note ?? "В файле не нашлось текстового слоя, и страницы не удалось прочитать. Строки не выдуманы.";
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
  } else if (ext === "xls" || ext === "xlsx") {
    try {
      decoded = extractSpreadsheet(bytes).text;
    } catch {
      decoded = "";
    }
    if (!decoded.trim()) {
      document.status = "anonymization_unconfirmed";
      document.statusLabel = "Таблица сохранена отдельно";
      document.note = "В Excel-файле не найдено читаемого содержимого. Значения не выдуманы.";
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
  document.note = parsed.facts.length > 0 ? "Текст прочитан целиком, персональные данные в нём скрыты." : "Текст прочитан целиком. Отдельных показателей словаря в нём не найдено, строки сохранены.";
  document.studyDate = parsed.studyDate;
  document.anonymizedText = anonymized.text;
  for (const fact of parsed.facts) state.facts.push({ ...fact, id: newId(), documentId: id });
  for (const medication of parsed.medications) state.medications.push({ ...medication, id: newId(), documentId: id });
  for (const issue of parsed.issues) state.issues.push({ ...issue, id: newId(), documentId: id });
  state.report = null;
  return document;
}
