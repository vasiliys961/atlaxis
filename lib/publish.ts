import { searchGuidelines } from "./guidelines-search";
import { BRAIN_MODELS } from "./models";
import { newId } from "./parse";
import { polzaKey, polzaText } from "./polza";
import { buildReport } from "./report";
import type { OwnerState, ReportView } from "./types";
import { acceptWording } from "./wording";

export function themePrompt(title: string, packet: string): string {
  return `Это одна тема уже собранного разбора, не весь комплект. Перескажи только её одним законченным абзацем. Не связывай с другими темами. Не ставь диагноз, не назначай лечение и не добавляй чисел.\n\nТема: ${title}\n${packet}`;
}

async function narrateThemes(report: ReportView, state: OwnerState): Promise<void> {
  await Promise.all(report.themes.filter((theme) => theme.body.trim() && !theme.notes?.length).map(async (theme) => {
    const packet = [theme.lead, theme.body].filter(Boolean).join("\n");
    const prompt = themePrompt(theme.title, packet);
    const notes = await Promise.all(BRAIN_MODELS.map(async (model) => {
      try {
        const text = await polzaText(model.id, prompt, 280);
        return acceptWording(text, state, packet) ? { model: model.id, label: model.label, text } : null;
      } catch {
        return null;
      }
    }));
    const kept = notes.flatMap((item) => (item ? [item] : []));
    if (kept.length > 0) theme.notes = kept;
  }));
}

export async function publishReport(state: OwnerState): Promise<ReportView> {
  const report = buildReport(state);
  report.modelsReady = Boolean(polzaKey());
  const previous = state.report;
  const same = previous?.inputHash === report.inputHash;
  const canAsk = Boolean(report.modelsReady && report.status === "ready" && state.documents.some((item) => item.status === "ready"));
  if (same && previous) {
    for (const theme of report.themes) {
      const saved = previous.themes.find((item) => item.title === theme.title && item.body === theme.body);
      if (saved?.notes?.length) theme.notes = saved.notes;
    }
  }
  const [guidelineSearch] = await Promise.all([
    same && previous?.guidelineSearch
      ? Promise.resolve(previous.guidelineSearch)
      : canAsk && state.facts.length > 0 ? searchGuidelines(state) : Promise.resolve(null),
    canAsk ? narrateThemes(report, state) : Promise.resolve(),
  ]);
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
