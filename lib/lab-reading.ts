import { readingLines, type ImageReading } from "./image-json";
import { parseDocument, type ParsedDocument } from "./parse";

const unitKey = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/µ|μ/g, "мк").replace(/литр/g, "л");
const numeric = (s: string): number | null => /^-?\d+(?:[.,]\d+)?$/.test(s.trim()) ? Number(s.replace(",", ".")) : null;

// OCR lines and structured rows come from the same vision response: agreement
// is an internal consistency check, not independent verification of the image.
export function reconcileLabReading(reading: ImageReading): ParsedDocument {
  const text = readingLines(reading);
  const parsed = parseDocument(text);
  const headerOffset = reading.studyDate ? 1 : 0;
  const structuredStart = headerOffset + reading.lines.length + 1;
  parsed.issues = parsed.issues.filter(i => !(i.description.startsWith("В одном документе") && i.line < structuredStart && (i.otherLine ?? 0) >= structuredStart));
  const original = parsed.facts.filter(f => f.line < structuredStart);
  const removed = new Set<ParsedDocument["facts"][number]>();
  const addIssue = (description: string, a: ParsedDocument["facts"][number], b?: ParsedDocument["facts"][number]) => {
    parsed.issues.push({ description, line: a.line, excerpt: a.excerpt, ...(b ? { otherLine: b.line, otherExcerpt: b.excerpt } : {}) });
    a.status = "conflicting";
    if (b) b.status = "conflicting";
  };
  reading.measurements.forEach((row, index) => {
    const line = structuredStart + index;
    const fact = parsed.facts.find(f => f.line === line);
    if (!fact) return; // Unmapped or qualitative rows remain in the source text.
    const low = row.referenceLow ? numeric(row.referenceLow) : null;
    const high = row.referenceHigh ? numeric(row.referenceHigh) : null;
    fact.unit = row.unit;
    fact.referenceLow = low;
    fact.referenceHigh = high;
    if ((row.referenceLow && low === null) || (row.referenceHigh && high === null)) addIssue("Референс структурированной строки не является числовой границей. Непроверенная граница не использована.", fact);
    if (low !== null && high !== null && low > high) addIssue("Границы референса перепутаны; разбор не исправляет их автоматически.", fact);
    const matches = original.filter(other => other.concept === fact.concept);
    if (!matches.length) return;
    // Multiple occurrences can be different samples or dates; do not guess a pairing.
    if (matches.length > 1) {
      for (const other of matches) addIssue("Показатель повторён в OCR. Нельзя однозначно сопоставить структурированную строку с образцом или датой.", fact, other);
      fact.date = null; fact.dateStatus = "unknown";
      return;
    }
    const other = matches[0];
    const disagreements: string[] = [];
    if (other.value !== fact.value) disagreements.push("значение");
    if (other.unit && fact.unit && unitKey(other.unit) !== unitKey(fact.unit)) disagreements.push("единицы");
    if (other.referenceLow !== null && low !== null && other.referenceLow !== low) disagreements.push("нижний референс");
    if (other.referenceHigh !== null && high !== null && other.referenceHigh !== high) disagreements.push("верхний референс");
    if (other.date && reading.studyDate && other.date !== reading.studyDate) disagreements.push("дата");
    if (disagreements.length) {
      addIssue(`OCR и структурированная строка расходятся: ${disagreements.join(", ")}. Ни одна версия не выбрана как правильная.`, fact, other);
      if (disagreements.includes("дата")) { fact.date = null; fact.dateStatus = "unknown"; }
    } else if (fact.status !== "conflicting") {
      // Keep the structured source line, filling only fields present in OCR.
      fact.unit ||= other.unit;
      fact.referenceLow ??= other.referenceLow;
      fact.referenceHigh ??= other.referenceHigh;
      fact.date = other.date ?? fact.date;
      fact.dateStatus = fact.date ? "known" : "unknown";
      fact.status = fact.date && fact.unit && fact.value >= 0 ? "extracted" : "uncertain";
      removed.add(other);
    }
  });
  parsed.facts = parsed.facts.filter(f => !removed.has(f));
  // All raw variants remain addressable in readingLines, including discrepancies.
  if (parsed.issues.some(i => /разные даты|дата|Дата/.test(i.description))) parsed.studyDate = null;
  for (const fact of parsed.facts) {
    if (parsed.issues.some(i => i.line === fact.line || i.otherLine === fact.line)) fact.status = "conflicting";
  }
  return parsed;
}
