import { anonymizeText } from "./anonymize";

export type ImageMeasurement = {
  name: string;
  value: string;
  unit: string;
  referenceLow: string;
  referenceHigh: string;
};

export type ImageMedication = {
  name: string;
  dose: string;
  unit: string;
};

export type ImageReading = {
  visualFindings?: { description: string; region: string; confidence: "low" | "moderate"; frame: number | null }[];
  studyDate: string;
  lines: string[];
  measurements: ImageMeasurement[];
  medications: ImageMedication[];
};

const EMPTY: ImageReading = { studyDate: "", lines: [], measurements: [], medications: [] };

function text(value: unknown, limit = 240): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

export const IMAGE_READING_MAX_ROWS = 500;
export const IMAGE_READING_MAX_TEXT = 120_000;

function rows<T>(value: unknown, map: (item: unknown) => T | null, limit = IMAGE_READING_MAX_ROWS): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(map).filter((item): item is T => item !== null);
}

export function sanitizeImageReading(raw: unknown): ImageReading | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  // Refuse oversized answers rather than silently publishing a shortened reading.
  if (JSON.stringify(raw).length > IMAGE_READING_MAX_TEXT) return null;
  const limits: Record<string, Record<string, number>> = {
    measurements: { name: 160, value: 40, unit: 40, referenceLow: 40, referenceHigh: 40 },
    medications: { name: 160, dose: 40, unit: 40 },
    visualFindings: { description: 600, region: 160 },
  };
  for (const field of ["lines", "measurements", "medications", "visualFindings"]) {
    const values = source[field];
    if (!Array.isArray(values)) continue;
    if (values.length > IMAGE_READING_MAX_ROWS) return null;
    for (const value of values) {
      if (field === "lines" && String(value ?? "").replace(/\s+/g, " ").trim().length > 4000) return null;
      if (value && typeof value === "object") {
        for (const [key, limit] of Object.entries(limits[field] ?? {})) {
          const item = (value as Record<string, unknown>)[key];
          if ((typeof item === "string" || typeof item === "number") && String(item).replace(/\s+/g, " ").trim().length > limit) return null;
        }
      }
    }
  }
  const reading: ImageReading = {
    visualFindings: rows(source.visualFindings, (item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const description = text(row.description, 800);
      if (!description) return null;
      return { description, region: text(row.region), confidence: row.confidence === "moderate" ? "moderate" as const : "low" as const, frame: Number.isInteger(row.frame) && Number(row.frame) >= 0 ? Number(row.frame) : null };
    }, 40),
    studyDate: /^\d{4}-\d{2}-\d{2}$/.test(text(source.studyDate, 10)) ? text(source.studyDate, 10) : "",
    lines: rows(source.lines, (item) => {
      const line = text(item, 4000);
      return line || null;
    }, 240),
    measurements: rows(source.measurements, (item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const measurement = {
        name: text(row.name),
        value: text(row.value, 40),
        unit: text(row.unit, 40),
        referenceLow: text(row.referenceLow, 40),
        referenceHigh: text(row.referenceHigh, 40),
      };
      return measurement.name && measurement.value ? measurement : null;
    }, 160),
    medications: rows(source.medications, (item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const medication = { name: text(row.name), dose: text(row.dose, 40), unit: text(row.unit, 40) };
      return medication.name && medication.dose ? medication : null;
    }, 80),
  };
  const filled = reading.lines.length + reading.measurements.length + reading.medications.length + (reading.visualFindings?.length ?? 0);
  return filled > 0 || reading.studyDate ? reading : { ...EMPTY };
}

export function readingLines(reading: ImageReading): string {
  const lines: string[] = [];
  if (reading.studyDate) lines.push(`Дата исследования: ${reading.studyDate}`);
  for (const line of reading.lines) lines.push(line);
  for (const item of reading.measurements) {
    const range = item.referenceLow && item.referenceHigh ? ` ${item.referenceLow}-${item.referenceHigh}` : item.referenceLow ? ` референс: >=${item.referenceLow}` : item.referenceHigh ? ` референс: <=${item.referenceHigh}` : "";
    lines.push(`${item.name} ${item.value} ${item.unit}${range}`.trim());
  }
  for (const item of reading.medications) lines.push(`${item.name} ${item.dose} ${item.unit}`.trim());
  return lines.join("\n");
}

function kept(value: string): string {
  const result = anonymizeText(value);
  return result.leaked ? "" : result.text;
}

export function scrubReading(reading: ImageReading): { json: string; lines: string; leaked: boolean } {
  const clean: ImageReading = {
    visualFindings: (reading.visualFindings ?? []).flatMap((item) => {
      const description = kept(item.description);
      if (!description) return [];
      return [{ description, region: kept(item.region), confidence: item.confidence, frame: item.frame }];
    }),
    studyDate: kept(reading.studyDate),
    lines: reading.lines.map(kept).filter(Boolean),
    measurements: reading.measurements.flatMap((item) => {
      const name = kept(item.name);
      const value = kept(item.value);
      if (!name || !value) return [];
      return [{ name, value, unit: kept(item.unit), referenceLow: kept(item.referenceLow), referenceHigh: kept(item.referenceHigh) }];
    }),
    medications: reading.medications.flatMap((item) => {
      const name = kept(item.name);
      const dose = kept(item.dose);
      if (!name || !dose) return [];
      return [{ name, dose, unit: kept(item.unit) }];
    }),
  };
  const filled = clean.lines.length + clean.measurements.length + clean.medications.length + (clean.visualFindings?.length ?? 0) + (clean.studyDate ? 1 : 0);
  const had = reading.lines.length + reading.measurements.length + reading.medications.length + (reading.visualFindings?.length ?? 0) + (reading.studyDate ? 1 : 0);
  return { json: JSON.stringify(clean), lines: readingLines(clean), leaked: had > 0 && filled === 0 };
}

export function mergeReadings(parts: ImageReading[]): ImageReading {
  const merged = sanitizeImageReading({
    studyDate: parts.find((item) => item.studyDate)?.studyDate ?? "",
    lines: parts.flatMap((item) => item.lines),
    measurements: parts.flatMap((item) => item.measurements),
    medications: parts.flatMap((item) => item.medications),
    visualFindings: parts.flatMap((item) => item.visualFindings ?? []),
  });
  return merged ?? { studyDate: "", lines: [], measurements: [], medications: [] };
}
