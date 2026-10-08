import { identityLeft } from "./anonymize";
import { readingLines, sanitizeImageReading } from "./image-json";
import type { OwnerState, SourceRef } from "./types";

export type InstrumentStudy = {
  documentId: string; documentName: string; kind: "ecg" | "spirometry";
  parameters: { name: string; valueText: string | null; unit: string | null; context: string; status: "printed" | "ambiguous"; source: SourceRef }[];
  recordedConclusions: SourceRef[];
  limitations: string[];
};
const EDGE = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
const markers: { name: string; kind: InstrumentStudy["kind"]; pattern: RegExp }[] = [
  ["FEV1/FVC", "spirometry", "(?:FEV[₁1]\\s*[/／]\\s*FVC|ОФВ[₁1]\\s*[/／]\\s*ФЖЕЛ)"],
  ["FEV1", "spirometry", "(?:FEV[₁1]|ОФВ[₁1])"],
  ["FVC", "spirometry", "(?:FVC|ФЖЕЛ)"],
  ["PEF", "spirometry", "(?:PEF|ПОС)"],
  ["PR/PQ", "ecg", "(?:PR|PQ)"],
  ["QRS", "ecg", "QRS"],
  ["QTc", "ecg", "QTc"],
  ["QT", "ecg", "QT"],
  ["ЧСС", "ecg", "(?:ЧСС|HR|heart rate)"],
  ["Скорость записи", "ecg", "(?:скорость(?: записи)?|paper speed)"],
  ["Усиление", "ecg", "(?:усиление|gain)"],
].map(([name, kind, pattern]) => ({ name, kind: kind as InstrumentStudy["kind"], pattern: new RegExp(EDGE + pattern + END, "iu") }));
const injection = /ignore previous|игнорируй предыдущ|you are now|системн[\p{L}]*\s+промпт/iu;

export function instrumentStudies(state: OwnerState): InstrumentStudy[] {
  return state.documents.filter(d => d.status === "ready").flatMap(document => {
    let text = document.anonymizedText;
    if (/\.(png|jpe?g|webp)$/i.test(document.fileName)) {
      try { const r = sanitizeImageReading(JSON.parse(text)); if (!r) return []; text = readingLines(r); } catch { return []; }
    }
    if (identityLeft(text)) return [];
    const lines = text.split(/\r?\n/).map((excerpt, i) => ({ documentId: document.id, documentName: document.fileName, line: i + 1, excerpt })).filter(s => !injection.test(s.excerpt));
    const kinds: InstrumentStudy["kind"][] = [];
    if (lines.some(s => /(?<![\p{L}])(?:ЭКГ|ECG|электрокардиограмм[\p{L}]*)(?![\p{L}])/iu.test(s.excerpt))) kinds.push("ecg");
    if (lines.some(s => /спирометр|спирограф|spirometry|FEV[₁1]|ОФВ[₁1]|ФЖЕЛ/iu.test(s.excerpt))) kinds.push("spirometry");
    return kinds.map(kind => {
      const parameters: InstrumentStudy["parameters"] = [];
      for (const source of lines) {
        // Read only one printed parameter at a time. Tables, dates, coefficients
        // and multiple columns are retained verbatim instead of selecting a number.
        const found = markers.filter(m => m.kind === kind && m.pattern.test(source.excerpt));
        const ratio = found.find(m => m.name === "FEV1/FVC");
        const marker = ratio ?? found[0];
        if (!marker) continue;
        const hit = source.excerpt.match(marker.pattern)!;
        const tail = source.excerpt.slice(hit.index! + hit[0].length).trim().replace(/^[:=]\s*/, "");
        const single = tail.match(/^(-?\d+(?:[.,]\d+)?)\s*(мс|ms|с|s|уд\/?мин|bpm|л\/с|L\/s|л\/мин|L\/min|л|L|%|мм\/с|mm\/s|мм\/мВ|mm\/mV)?\s*$/iu);
        const unit = single?.[2] ?? null;
        const expected = marker.kind === "ecg" ? marker.name === "ЧСС" ? /^(уд\/?мин|bpm)$/iu : marker.name === "Скорость записи" ? /^(мм\/с|mm\/s)$/iu : marker.name === "Усиление" ? /^(мм\/мВ|mm\/mV)$/iu : /^(мс|ms|с|s)$/iu : marker.name === "FEV1/FVC" ? /^%$/u : marker.name === "PEF" ? /^(л\/с|L\/s|л\/мин|L\/min)$/iu : /^(л|L)$/iu;
        const unambiguous = Boolean(single && Number(single[1].replace(",", ".")) >= 0 && unit && expected.test(unit) && (ratio || found.length === 1));
        const context = /\bpost\b|после|постбронх/iu.test(source.excerpt) ? "после пробы (указано в строке)" : /\bpre\b|до пробы|до бронх/iu.test(source.excerpt) ? "до пробы (указано в строке)" : "условия и столбец не установлены";
        const parameter = { name: marker.name, valueText: unambiguous ? single![1] : null, unit: unambiguous ? unit : null, context, status: unambiguous ? "printed" as const : "ambiguous" as const, source };
        if (!parameters.some(p => p.name === parameter.name && p.source.excerpt === source.excerpt)) parameters.push(parameter);
      }
      return { documentId: document.id, documentName: document.fileName, kind, parameters, recordedConclusions: lines.filter(s => /^(?:заключение|conclusion|interpretation)\s*:/iu.test(s.excerpt.trim())), limitations: ["Извлечены только напечатанные записи; точность OCR требует сверки с оригиналом.", "Кривая не измеряется по пикселям. Диагноз и назначения по ней не формируются.", kind === "ecg" ? "Наличие записи скорости или усиления не подтверждает калибровку скана; QTc не пересчитывается и формула не предполагается." : "Несколько чисел в таблице не распределяются автоматически по столбцам. Должные значения, LLN, z-score и ответ на пробу не вычисляются; качество манёвра по этим данным не подтверждается."] };
    });
  });
}
