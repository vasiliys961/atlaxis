import { readingLines, sanitizeImageReading } from "./image-json";

const READING_LIMIT = 24_000;
const EMBEDDED_INSTRUCTION = /игнорируй предыдущ|ignore previous|поставь диагноз|you are now|системн[\p{L}]*\s+промпт/iu;

function safeReadingLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !EMBEDDED_INSTRUCTION.test(line))
    .join("\n");
}

export function documentReadingText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{")) return safeReadingLines(raw);
  try {
    const reading = sanitizeImageReading(JSON.parse(trimmed));
    if (!reading) return "";
    const visuals = (reading.visualFindings ?? []).map((item) => {
      const place = item.region ? `, ${item.region}` : "";
      return `Видимое наблюдение (${item.confidence}${place}): ${item.description}`;
    });
    return safeReadingLines([readingLines(reading), ...visuals].filter(Boolean).join("\n"));
  } catch {
    return "";
  }
}

export function readingForSheet(raw: string): string {
  const text = documentReadingText(raw).trim();
  if (text.length <= READING_LIMIT) return text;
  return `${text.slice(0, READING_LIMIT)}\n… текст обрезан по длине листа.`;
}
