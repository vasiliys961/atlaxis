import { searchGuidelines } from "./guidelines-search";
import { BRAIN_MODELS } from "./models";
import { newId } from "./parse";
import { polzaKey, polzaText } from "./polza";
import { buildReport } from "./report";
import type { OwnerState, ReportView } from "./types";
import { acceptWording } from "./wording";

function sourceOf(report: ReportView): string {
  return [
    report.headline,
    report.intro,
    report.guidelineNote,
    ...report.themes.map((item) => `${item.title}\n${item.body}`),
    ...report.changes.map((item) => `${item.title}\n${item.body}`),
    ...report.conflicts.map((item) => `${item.title}\n${item.body}`),
    ...report.relationships.map((item) => item.body),
    ...report.gaps,
    ...report.questions,
    ...report.cannotSay,
    ...report.limits,
    ...(report.imageReadings ?? []).map((item) => item.json),
  ].join("\n").slice(0, 12000);
}

async function narrate(report: ReportView, state: OwnerState): Promise<NonNullable<ReportView["wording"]> | null> {
  const source = sourceOf(report);
  const prompt = `Ниже справочный разбор и JSON снимков. Перескажи это пациенту коротко и только этими сведениями. Не добавляй числа, дозы, диагноз, назначение и совет сдать анализ.\n\n${source}`;
  const results = await Promise.all(
    BRAIN_MODELS.map(async (model) => {
      try {
        const text = await polzaText(model.id, prompt, 500);
        return acceptWording(text, state) ? { model: model.id, label: model.label, text } : null;
      } catch {
        return undefined;
      }
    }),
  );
  if (results.every((item) => item === undefined)) return null;
  return results.flatMap((item) => (item ? [{ model: item.model, label: item.label, text: item.text }] : []));
}

export async function publishReport(state: OwnerState): Promise<ReportView> {
  const report = buildReport(state);
  report.modelsReady = Boolean(polzaKey());
  const previous = state.report;
  const same = previous?.inputHash === report.inputHash;
  const canAsk = Boolean(report.modelsReady && report.status === "ready" && state.documents.some((item) => item.status === "ready"));
  const [wording, guidelineSearch] = await Promise.all([
    same && previous?.wording
      ? Promise.resolve(previous.wording)
      : canAsk ? narrate(report, state) : Promise.resolve(null),
    same && previous?.guidelineSearch
      ? Promise.resolve(previous.guidelineSearch)
      : canAsk && state.facts.length > 0 ? searchGuidelines(state) : Promise.resolve(null),
  ]);
  if (wording) report.wording = wording;
  if (guidelineSearch) report.guidelineSearch = guidelineSearch;
  state.report = report;
  const last = state.reports[state.reports.length - 1];
  if (!last || last.inputHash !== report.inputHash) {
    state.reports.push({ ...report, id: newId() });
    if (state.reports.length > 20) state.reports.splice(0, state.reports.length - 20);
  }
  return report;
}

export function listedDocuments(state: OwnerState) {
  return state.documents.map((document) => {
    const { anonymizedText: _text, ...safe } = document;
    return {
      ...safe,
      factCount: state.facts.filter((fact) => fact.documentId === document.id).length,
      issueCount: state.issues.filter((issue) => issue.documentId === document.id).length,
    };
  });
}
