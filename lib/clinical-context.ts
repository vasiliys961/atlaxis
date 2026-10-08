import { instrumentStudies } from "./instrument-studies";
import { analyzeClinicalState } from "./clinical-engine";
import { identityLeft } from "./anonymize";
import { sourceDocumentText } from "./source-document";
import type { OwnerState, SourceRef } from "./types";

export const CONTEXT_LIMIT = 120_000;
const INSTRUCTION = /игнорируй предыдущ|ignore previous|поставь диагноз|you are now|системн[\p{L}]*\s+промпт/iu;

export type ClinicalContext = {
  packet: string;
  sources: Map<string, SourceRef>;
  visualSources: Set<string>;
  complete: boolean;
  reasons: string[];
};

export function buildClinicalContext(state: OwnerState, guidelineSearch?: string): ClinicalContext {
  const visualSources = new Set<string>();
  const sources = new Map<string, SourceRef>();
  const reasons: string[] = [];
  const documents = state.documents.filter(d => d.status === "ready").map((document, index) => {
    let text = document.anonymizedText;
    const image = /\.(png|jpe?g|webp)$/i.test(document.fileName);
    const dicom = /\.(dcm|dicom)$/i.test(document.fileName);
    if (image) {
      try {
        text = sourceDocumentText(document);
      } catch {
        reasons.push("Распознанный текст изображения не удалось проверить.");
        text = "";
      }
    }
    if (identityLeft(text)) {
      reasons.push("В документе остались идентифицирующие данные.");
      text = "";
    }
    const lines = text.split(/\r?\n/).flatMap((excerpt, i) => {
      if (!excerpt.trim() || INSTRUCTION.test(excerpt)) return [];
      const id = `${document.id}:${i + 1}`;
      sources.set(id, { documentId: document.id, documentName: document.fileName, line: i + 1, excerpt });
      return [{ id, text: excerpt }];
    });
    const observations = (document.visualAnalysis?.findings ?? []).map((finding, i) => {
      const id = `${document.id}:visual:${i + 1}`;
      const excerpt = `Предварительное визуальное наблюдение ИИ: ${finding.description}; область: ${finding.region || "не установлена"}; кадр: ${finding.frame ?? "не указан"}; уверенность: ${finding.confidence}.`;
      sources.set(id, { documentId: document.id, documentName: document.fileName, line: i + 1, excerpt });
      visualSources.add(id);
      return { id, text: excerpt, origin: "model_pixel_observation" };
    });
    return {
      document: index + 1,
      modality: image ? "image_text_and_pixel_observations" : dicom ? "dicom_metadata_and_pixel_observations" : "clinical_text",
      pixelAnalysis: document.visualAnalysis ? { status: document.visualAnalysis.status, totalFrames: document.visualAnalysis.totalFrames, analyzedFrames: document.visualAnalysis.analyzedFrames, coverage: document.visualAnalysis.coverage, limitations: document.visualAnalysis.limitations } : null,
      observations,
      studyDate: document.studyDate,
      lines,
    };
  });
  if (!sources.size) reasons.push("Нет читаемого клинического текста для комплексного разбора.");
  const ready = new Set(state.documents.filter(d => d.status === "ready").map(d => d.id));
  const clinical = analyzeClinicalState(state);
  const packet = JSON.stringify({
    region: state.region,
    guidelines: { primaryRegion: state.region, searchStatus: guidelineSearch ? "retrieved_not_independently_verified" : "unavailable", searchText: guidelineSearch ?? "Поиск источников не выполнен; актуальность рекомендаций не подтверждена." },
    documents,
    instrumentStudies: instrumentStudies(state),
    unavailableDocuments: state.documents.filter(d => d.status !== "ready").map((d, i) => ({ document: i + 1, status: d.status })),
    facts: state.facts.filter(f => ready.has(f.documentId)).map(f => ({ concept: f.concept, value: f.value, unit: f.unit, date: f.date, referenceLow: f.referenceLow, referenceHigh: f.referenceHigh, status: f.status, source: `${f.documentId}:${f.line}` })),
    medications: state.medications.filter(m => ready.has(m.documentId)).map(m => ({ name: m.name, dose: m.dose, unit: m.unit, frequency: m.frequency ?? null, date: m.date, source: `${m.documentId}:${m.line}` })),
    axes: clinical.axes.map(a => ({ id: a.axisId, status: a.status, missing: a.missing, trends: a.trends.map(t => t.explanation), conflicts: a.conflicts.map(c => c.explanation) })),
    documentIssues: state.issues.filter(i => ready.has(i.documentId)).map(i => ({ description: i.description, source: `${i.documentId}:${i.line}` })),
  });
  if (packet.length > CONTEXT_LIMIT) reasons.push("Комплект превышает объём единого контекста; неполный разбор не публикуется.");
  return { packet, sources, visualSources, complete: reasons.length === 0, reasons };
}
