import { createHash, randomUUID } from "crypto";
import type { DocumentIssue, MedicalFact, MedicationMention } from "./types";

const CONCEPTS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "HBA1C", label: "гликированный гемоглобин", pattern: /(?<![\p{L}])(?:hba1c|гликирован[\p{L}]*)(?![\p{L}])/iu },
  { id: "HGB", label: "гемоглобин", pattern: /(?<![\p{L}])(?:гемоглобин|hemoglobin|hgb|hb)(?![\p{L}])/iu },
  { id: "WBC", label: "лейкоциты", pattern: /(?<![\p{L}])(?:лейкоцит[\p{L}]*|wbc)(?![\p{L}])/iu },
  { id: "PLT", label: "тромбоциты", pattern: /(?<![\p{L}])(?:тромбоцит[\p{L}]*|plt)(?![\p{L}])/iu },
  { id: "RBC", label: "эритроциты", pattern: /(?<![\p{L}])(?:эритроцит[\p{L}]*|rbc)(?![\p{L}])/iu },
  { id: "LDL_C", label: "ЛПНП", pattern: /(?<![\p{L}])(?:лпнп|ldl)(?![\p{L}])/iu },
  { id: "HDL_C", label: "ЛПВП", pattern: /(?<![\p{L}])(?:лпвп|hdl)(?![\p{L}])/iu },
  { id: "TG", label: "триглицериды", pattern: /(?<![\p{L}])(?:триглицерид[\p{L}]*|triglycerides?)(?![\p{L}])/iu },
  { id: "TC", label: "холестерин", pattern: /(?<![\p{L}])(?:холестерин|cholesterol)(?![\p{L}])/iu },
  { id: "GLU", label: "глюкоза", pattern: /(?<![\p{L}])(?:глюкоз[\p{L}]*|glucose)(?![\p{L}])/iu },
  { id: "CREAT", label: "креатинин", pattern: /(?<![\p{L}])(?:креатинин|creatinine)(?![\p{L}])/iu },
  { id: "UREA", label: "мочевина", pattern: /(?<![\p{L}])(?:мочевин[\p{L}]*|urea)(?![\p{L}])/iu },
  { id: "EGFR", label: "рСКФ", pattern: /(?<![\p{L}])(?:рскф|egfr|скф)(?![\p{L}])/iu },
  { id: "ALT", label: "АЛТ", pattern: /(?<![\p{L}])(?:алт|alt)(?![\p{L}])/iu },
  { id: "AST", label: "АСТ", pattern: /(?<![\p{L}])(?:аст|ast)(?![\p{L}])/iu },
  { id: "GGT", label: "ГГТ", pattern: /(?<![\p{L}])(?:ггт|ggt)(?![\p{L}])/iu },
  { id: "BILI", label: "билирубин", pattern: /(?<![\p{L}])(?:билирубин|bilirubin)(?![\p{L}])/iu },
  { id: "TSH", label: "ТТГ", pattern: /(?<![\p{L}])(?:ттг|tsh)(?![\p{L}])/iu },
  { id: "CRP", label: "СРБ", pattern: /(?<![\p{L}])(?:срб|crp|с-реактивн[\p{L}]*)(?![\p{L}])/iu },
  { id: "FERRITIN", label: "ферритин", pattern: /(?<![\p{L}])(?:ферритин|ferritin)(?![\p{L}])/iu },
  { id: "URIC", label: "мочевая кислота", pattern: /(?<![\p{L}])(?:мочевая кислота|uric acid|urate)(?![\p{L}])/iu },
  { id: "AMYLASE", label: "амилаза", pattern: /(?<![\p{L}])(?:амилаз[\p{L}]*|amylase)(?![\p{L}])/iu },
  { id: "VITD", label: "витамин D", pattern: /(?<![\p{L}])(?:витамин\s*[dд]|25-oh)(?![\p{L}])/iu },
  { id: "INR", label: "МНО", pattern: /(?<![\p{L}])(?:мно|inr)(?![\p{L}])/iu },
  { id: "NA", label: "натрий", pattern: /(?<![\p{L}])(?:натрий|sodium)(?![\p{L}])/iu },
  { id: "K", label: "калий", pattern: /(?<![\p{L}])(?:калий|potassium)(?![\p{L}])/iu },
  { id: "BP_SYS", label: "верхнее давление", pattern: /(?<![\p{L}])(?:артериальн[\p{L}]*\s+давлени[\p{L}]*|ад|blood pressure)(?![\p{L}])/iu },
];

const DATE_LINE = /дат[аы](?:\s+исследовани[\p{L}]+|\s+анализа)?\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4})/iu;
const INSTRUCTION = /игнорируй предыдущ|ignore previous|поставь диагноз|you are now|системн[\p{L}]*\s+промпт/iu;
const CONCLUSION = /заключен/i;
const NORMAL_CLAIM = /в пределах нормы|показател\w+\s+в норме|\bнорма\b/i;
const DOSE = /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]{3,})\s+(\d+(?:[.,]\d+)?)\s*(мг|мкг|ме|ед)(?:\s+(\d+\s+раз(?:а)?(?:\s+в\s+(?:день|сутки|неделю))?))?(?![\p{L}\p{N}])/iu;

export type ParsedDocument = {
  studyDate: string | null;
  facts: Omit<MedicalFact, "id" | "documentId">[];
  medications: Omit<MedicationMention, "id" | "documentId">[];
  issues: Omit<DocumentIssue, "id" | "documentId">[];
};

function isoDate(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  const year = iso?.[1] ?? local?.[3];
  const month = iso?.[2] ?? local?.[2];
  const day = iso?.[3] ?? local?.[1];
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

function numberFrom(raw: string): number {
  return Number(raw.replace(",", "."));
}

function laterThanToday(iso: string): boolean {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Date.parse(`${iso}T00:00:00Z`) > today;
}

function stampFact<T extends { date: string | null; unit: string; value: number }>(fact: T) {
  return {
    ...fact,
    dateStatus: fact.date ? "known" as const : "unknown" as const,
    extraction: "text" as const,
    status: !fact.date || !fact.unit.trim() || fact.value < 0 ? "uncertain" as const : "extracted" as const,
  };
}

function pair(issue: { description: string; line: number; excerpt: string }, other?: { line: number; excerpt: string }) {
  return other ? { ...issue, otherLine: other.line, otherExcerpt: other.excerpt } : issue;
}

export function parseDocument(text: string): ParsedDocument {
  const lines = text.split(/\r?\n/);
  let studyDate: string | null = null;
  const facts: ParsedDocument["facts"] = [];
  const medications: ParsedDocument["medications"] = [];
  const issues: ParsedDocument["issues"] = [];
  let conclusionSaysNormal = false;
  let conclusionLine = 0;
  let conclusionExcerpt = "";
  const dates: { date: string; line: number; excerpt: string }[] = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line) return;
    if (INSTRUCTION.test(line)) {
      issues.push({
        description: "В документе есть фраза, похожая на инструкцию системе. Она не выполнена и в факты не попала.",
        line: lineNo,
        excerpt: "инструкция скрыта",
      });
      return;
    }

    const dated = line.match(DATE_LINE);
    if (dated?.[1]) {
      const parsedDate = isoDate(dated[1]);
      if (!parsedDate || laterThanToday(parsedDate)) {
        issues.push({
          description: "Дата в строке не складывается в календарную или стоит позже сегодняшнего дня. Она не подставлена.",
          line: lineNo,
          excerpt: line.slice(0, 180),
        });
      } else {
        studyDate = parsedDate;
        dates.push({ date: parsedDate, line: lineNo, excerpt: line.slice(0, 180) });
      }
      return;
    }

    if (CONCLUSION.test(line) && NORMAL_CLAIM.test(line)) {
      conclusionSaysNormal = true;
      conclusionLine = lineNo;
      conclusionExcerpt = line.slice(0, 180);
    }

    const concept = CONCEPTS.find((item) => item.pattern.test(line));
    if (concept) {
      if (concept.id === "BP_SYS") {
        const bp = line.match(/(\d{2,3})\s*[/\\]\s*(\d{2,3})/);
        if (bp?.[1] && bp[2]) {
          const systolic = numberFrom(bp[1]);
          const diastolic = numberFrom(bp[2]);
          if (systolic <= diastolic) {
            issues.push({
              description: `В одной строке верхнее давление ${bp[1]} не больше нижнего ${bp[2]}. Обе цифры оставлены, ни одна не выбрана.`,
              line: lineNo,
              excerpt: line,
            });
          }
          facts.push(stampFact({
            concept: "BP_SYS",
            label: "верхнее давление",
            value: systolic,
            valueText: bp[1],
            unit: "мм рт. ст.",
            date: studyDate,
            referenceLow: null,
            referenceHigh: null,
            line: lineNo,
            excerpt: line,
          }));
          facts.push(stampFact({
            concept: "BP_DIA",
            label: "нижнее давление",
            value: diastolic,
            valueText: bp[2],
            unit: "мм рт. ст.",
            date: studyDate,
            referenceLow: null,
            referenceHigh: null,
            line: lineNo,
            excerpt: line,
          }));
        } else if (line.replace(concept.pattern, "").trim()) {
          issues.push({
            description: "В строке названо давление, но пары чисел нет. Значение не подставлено.",
            line: lineNo,
            excerpt: line.slice(0, 180),
          });
        }
        return;
      }

      const valueMatch = line.match(/(-?\d+(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яЁё/%µμ. ]+?)?(?:\s+(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?))?$/);
      if (!valueMatch?.[1]) {
        if (line.replace(concept.pattern, "").trim()) {
          issues.push({
            description: `В строке назван ${concept.label}, но числа рядом нет. Значение не подставлено.`,
            line: lineNo,
            excerpt: line.slice(0, 180),
          });
        }
        return;
      }
      const low = valueMatch[3] ? numberFrom(valueMatch[3]) : null;
      const high = valueMatch[4] ? numberFrom(valueMatch[4]) : null;
      const value = numberFrom(valueMatch[1]);
      const fact = {
        concept: concept.id,
        label: concept.label,
        value,
        valueText: valueMatch[1].replace(",", "."),
        unit: (valueMatch[2] ?? "").trim(),
        date: studyDate,
        referenceLow: low,
        referenceHigh: high,
        line: lineNo,
        excerpt: line,
      };
      facts.push(stampFact(fact));
      if (value < 0) {
        issues.push({
          description: `${fact.label} записан как ${fact.valueText}. Число меньше нуля оставлено как в строке и не заменено.`,
          line: lineNo,
          excerpt: line,
        });
      }
      if (low != null && high != null && low > high) {
        issues.push({
          description: `У ${fact.label} референс бланка записан как ${low}–${high}. Границы не поменяны местами.`,
          line: lineNo,
          excerpt: line,
        });
      }
      return;
    }

    const dose = line.match(DOSE);
    if (dose?.[1] && dose[2] && dose[3]) {
      medications.push({
        name: dose[1].toLowerCase(),
        dose: numberFrom(dose[2]),
        doseText: dose[2].replace(",", "."),
        unit: dose[3].toLowerCase(),
        frequency: dose[4]?.toLowerCase(),
        date: studyDate,
        line: lineNo,
        excerpt: line,
      });
    }
  });

  const uniqueDates = [...new Set(dates.map((item) => item.date))];
  if (uniqueDates.length > 1) {
    const first = dates[0];
    const second = dates.find((item) => item.date !== first?.date);
    if (first && second) {
      issues.push(pair(
        {
          description: `В документе разные даты: ${uniqueDates.join(" и ")}. Для каждой строки остаётся дата, которая стоит выше неё. Одна дата на весь документ не выбирается.`,
          line: first.line,
          excerpt: first.excerpt,
        },
        second,
      ));
    }
  }

  const byConcept = new Map<string, typeof facts>();
  for (const fact of facts) {
    const list = byConcept.get(fact.concept) ?? [];
    list.push(fact);
    byConcept.set(fact.concept, list);
  }
  for (const list of byConcept.values()) {
    const first = list[0];
    const second = list[1];
    if (!first || !second) continue;
    const values = new Set(list.map((item) => item.valueText));
    const units = new Set(list.map((item) => item.unit).filter(Boolean));
    if (values.size > 1) {
      issues.push(pair(
        {
          description: `В одном документе ${first.label} записан по-разному: ${list.map((item) => `${item.valueText} ${item.unit}`.trim()).join(" и ")}. Разбор не выбирает одно число.`,
          line: first.line,
          excerpt: first.excerpt,
        },
        second,
      ));
    } else if (units.size > 1) {
      issues.push(pair(
        {
          description: `В одном документе у ${first.label} разные единицы: ${[...units].join(" и ")}. Единицы не пересчитаны.`,
          line: first.line,
          excerpt: first.excerpt,
        },
        second,
      ));
    }
  }

  if (conclusionSaysNormal) {
    for (const fact of facts) {
      const below = fact.referenceLow != null && fact.value < fact.referenceLow;
      const above = fact.referenceHigh != null && fact.value > fact.referenceHigh;
      if (below || above) {
        issues.push(pair(
          {
            description: `В заключении сказано, что показатели в норме, а ${fact.label} ${fact.valueText} ${fact.unit} выходит за референс этого же бланка ${fact.referenceLow}–${fact.referenceHigh}.`,
            line: fact.line,
            excerpt: fact.excerpt,
          },
          conclusionLine ? { line: conclusionLine, excerpt: conclusionExcerpt } : undefined,
        ));
      }
    }
  }

  return { studyDate, facts, medications, issues };
}

export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function newId(): string {
  return randomUUID();
}
