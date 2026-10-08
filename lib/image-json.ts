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

function text(value: unknown, limit = 160): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function rows<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map(map).filter((item): item is T => item !== null);
}

export function sanitizeImageReading(raw: unknown): ImageReading | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const reading: ImageReading = {
    visualFindings: rows(source.visualFindings, (item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const description = text(row.description, 600);
      if (!description) return null;
      return { description, region: text(row.region), confidence: row.confidence === "moderate" ? "moderate" as const : "low" as const, frame: Number.isInteger(row.frame) && Number(row.frame) >= 0 ? Number(row.frame) : null };
    }),
    studyDate: /^\d{4}-\d{2}-\d{2}$/.test(text(source.studyDate, 10)) ? text(source.studyDate, 10) : "",
    lines: rows(source.lines, (item) => {
      const line = text(item, 240);
      return line || null;
    }),
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
    }),
    medications: rows(source.medications, (item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const medication = { name: text(row.name), dose: text(row.dose, 40), unit: text(row.unit, 40) };
      return medication.name && medication.dose ? medication : null;
    }),
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

export function scrubReading(reading: ImageReading): { json: string; lines: string; leaked: boolean } {
  const scrub = (value: string) => anonymizeText(value);
  const date = scrub(reading.studyDate);
  const lines = reading.lines.map(scrub);
  const measurements = reading.measurements.map((item) => ({
    name: scrub(item.name),
    value: scrub(item.value),
    unit: scrub(item.unit),
    referenceLow: scrub(item.referenceLow),
    referenceHigh: scrub(item.referenceHigh),
  }));
  const medications = reading.medications.map((item) => ({
    name: scrub(item.name),
    dose: scrub(item.dose),
    unit: scrub(item.unit),
  }));
  const findings = (reading.visualFindings ?? []).map(item => ({ ...item, description: scrub(item.description), region: scrub(item.region) }));
  const leaked = [date, ...lines, ...measurements.flatMap((item) => Object.values(item)), ...medications.flatMap((item) => Object.values(item)), ...findings.flatMap(item => [item.description, item.region])].some(
    (item) => item.leaked,
  );
  const clean: ImageReading = {
    visualFindings: findings.map(item => ({ ...item, description: item.description.text, region: item.region.text })),
    studyDate: date.text,
    lines: lines.map((item) => item.text).filter(Boolean),
    measurements: measurements.map((item) => ({
      name: item.name.text,
      value: item.value.text,
      unit: item.unit.text,
      referenceLow: item.referenceLow.text,
      referenceHigh: item.referenceHigh.text,
    })),
    medications: medications.map((item) => ({ name: item.name.text, dose: item.dose.text, unit: item.unit.text })),
  };
  return { json: JSON.stringify(clean), lines: readingLines(clean), leaked };
}
