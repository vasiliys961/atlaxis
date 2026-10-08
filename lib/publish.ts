import { guidelineSentence } from "./guidelines";
import { RU_NOT_FOUND, SEARCH_SCOPE, searchGuidelines, sonarFoundRussian } from "./guidelines-search";
import { OPUS } from "./models";
import { writerFor } from "./router";
import { newId } from "./parse";
import { polzaKey, polzaText } from "./polza";
import { buildReport } from "./report";
import type { OwnerState, ReportView } from "./types";
import { acceptWording } from "./wording";
import { synthesizeClinicalState, type ClinicalSynthesis } from "./clinical-synthesis";

function reusableSynthesis(saved?: ClinicalSynthesis): boolean {
  return Boolean(saved?.version === "2" && (saved.status !== "unavailable" || Date.now() - Date.parse(saved.attemptedAt) < 5 * 60_000));
}

export function themePrompt(title: string, packet: string): string {
  return `Это одна тема уже собранного разбора, не весь комплект. Перескажи только её одним законченным абзацем. Не связывай с другими темами. Не ставь диагноз, не назначай лечение и не добавляй чисел.\n\nТема: ${title}\n${packet}`;
}

const THEMES_PER_PASS = 2;

export function reportNeedsRefresh(state: OwnerState): boolean {
  if (state.jobs.some((job) => job.status === "queued" || job.status === "running")) return false;
  if (!state.documents.some((item) => item.status === "ready")) return false;
  const next = buildReport(state);
  if (state.report?.inputHash !== next.inputHash) return true;
  if (!polzaKey()) return false;
  if (state.report?.status === "ready" && !reusableSynthesis(state.report.clinicalSynthesis)) return true;
  if (state.report?.status === "ready" && state.documents.some(d => d.status === "ready" && d.anonymizedText.trim())) {
    const text = state.report.guidelineSearch ?? "";
    if (!text.includes(SEARCH_SCOPE)) return true;
    if (state.region === "RU" && !sonarFoundRussian(text) && !text.includes(RU_NOT_FOUND)) return true;
  }
  return next.themes.some((theme) => {
    if (!theme.body.trim()) return false;
    const saved = state.report?.themes.find((item) => item.title === theme.title && item.body === theme.body);
    return !saved?.notes?.some((note) => note.model === writerFor(theme).id);
  });
}

async function narrateThemes(report: ReportView, state: OwnerState): Promise<void> {
  const open = report.themes.filter((theme) => {
    if (!theme.body.trim()) return false;
    return !theme.notes?.some((note) => note.model === writerFor(theme).id);
  }).slice(0, THEMES_PER_PASS);
  await Promise.all(open.map(async (theme) => {
    const packet = [theme.lead, theme.body].filter(Boolean).join("\n");
    const prompt = themePrompt(theme.title, packet);
    const writer = writerFor(theme);
    const ask = async (model: { id: string; label: string }) => {
      const text = await polzaText(model.id, prompt, 280);
      return acceptWording(text, state, packet) ? { model: model.id, label: model.label, text } : null;
    };
    try {
      const note = await ask(writer) ?? (writer.id === OPUS.id ? null : await ask(OPUS));
      if (note) theme.notes = [note];
    } catch {
      // Тема остаётся без абзаца, следующий заход попробует снова.
    }
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
      const written = saved?.notes?.filter((note) => note.model === writerFor(theme).id);
      if (written?.length) theme.notes = written;
    }
  }
  const savedSearch = same ? previous?.guidelineSearch : undefined;
  const reuseSearch = Boolean(
    savedSearch?.includes(SEARCH_SCOPE)
    && (report.region !== "RU" || sonarFoundRussian(savedSearch) || savedSearch.includes(RU_NOT_FOUND)),
  );
  const [guidelineSearch] = await Promise.all([
    reuseSearch
      ? Promise.resolve(savedSearch ?? null)
      : canAsk ? searchGuidelines(state) : Promise.resolve(null),
    canAsk ? narrateThemes(report, state) : Promise.resolve(),
  ]);
  if (guidelineSearch) report.guidelineSearch = guidelineSearch;
  if (report.region === "RU" && canAsk && !report.guidelineSearch) report.guidelineSearch = RU_NOT_FOUND;
  if (same && reusableSynthesis(previous?.clinicalSynthesis)) report.clinicalSynthesis = previous!.clinicalSynthesis;
  else if (canAsk) report.clinicalSynthesis = await synthesizeClinicalState(state, undefined, report.guidelineSearch);
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
