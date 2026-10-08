import { guidelineSentence } from "./guidelines";
import { RU_NOT_FOUND, SEARCH_SCOPE, settleSearch, searchGuidelines, sonarFoundRussian } from "./guidelines-search";
import { newId } from "./parse";
import { polzaKey } from "./polza";
import { buildReport } from "./report";
import type { OwnerState, ReportView } from "./types";
import { synthesizeClinicalState } from "./clinical-synthesis";


export function themePrompt(title: string, packet: string): string {
  return `Это одна тема уже собранного разбора, не весь комплект. Перескажи только её одним законченным абзацем. Не связывай с другими темами. Не ставь новый или предположительный диагноз, не формируй лечебный план, не назначай лечение и не добавляй чисел.\n\nТема: ${title}\n${packet}`;
}

export function reportNeedsRefresh(state: OwnerState): boolean {
  if (state.jobs.some((job) => job.status === "queued" || job.status === "running")) return false;
  if (!state.documents.some((item) => item.status === "ready")) return false;
  const next = buildReport(state);
  if (state.report?.inputHash !== next.inputHash) return true;
  return false;
}

export async function publishReport(state: OwnerState, force = false): Promise<ReportView> {
  const report = buildReport(state);
  report.modelsReady = Boolean(polzaKey());
  const previous = state.report;
  const same = previous?.inputHash === report.inputHash;
  if (same && previous && !force) return previous;
  const canAsk = Boolean(report.modelsReady && report.status === "ready" && state.documents.some((item) => item.status === "ready"));
  const savedSearch = same ? previous?.guidelineSearch : undefined;
  const reuseSearch = Boolean(
    savedSearch?.includes(SEARCH_SCOPE)
    && (report.region !== "RU" || sonarFoundRussian(savedSearch) || savedSearch.includes(RU_NOT_FOUND)),
  );
  const guidelineSearch = reuseSearch ? savedSearch ?? null : canAsk ? await searchGuidelines(state) : null;
  if (guidelineSearch) report.guidelineSearch = guidelineSearch;
  if (canAsk && !report.guidelineSearch) report.guidelineSearch = settleSearch(report.region === "RU" ? RU_NOT_FOUND : "Поиск источников недоступен.", report.region);
  if (canAsk) report.clinicalSynthesis = await synthesizeClinicalState(state, undefined, report.guidelineSearch);
  report.guidelineNote = guidelineSentence(report.region, report.guidelineSearch);
  state.report = report;
  const last = state.reports[state.reports.length - 1];
  if (!last || last.inputHash !== report.inputHash) {
    state.reports.push({ ...report, id: newId() });
    if (state.reports.length > 20) state.reports.splice(0, state.reports.length - 20);
  } else {
    state.reports[state.reports.length - 1] = { ...report, id: last.id };
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
