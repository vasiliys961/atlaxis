import { readingLines, sanitizeImageReading } from "./image-json";
import type { MedicalDocument } from "./types";

// The same line numbering is used by synthesis evidence and the source viewer.
export function sourceDocumentText(document: MedicalDocument): string {
  if (!/\.(png|jpe?g|webp)$/i.test(document.fileName)) return document.anonymizedText;
  const reading = sanitizeImageReading(JSON.parse(document.anonymizedText));
  if (!reading) throw new Error("invalid_image_reading");
  return readingLines(reading);
}
