import { instrumentStudies } from "./instrument-studies";
import { createHash } from "crypto";
import { identityLeft } from "./anonymize";
import { AXES } from "./catalog";
import { analyzeClinicalState } from "./clinical-engine";
import { reconcileMedications, medicationChangeText, medicationConflictText } from "./medication-reconciliation";
import { catalogEntries, guidelineSentence, guidelinesFor } from "./guidelines";
import { PIPELINE_VERSION, type MedicalFact, type MedicationMention, type OwnerState, type ReportBlock, type ReportView, type SourceRef, type TimelineEvent } from "./types";

function isPicture(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

export function buildRelationships(state: OwnerState): ReportBlock[] {
  const clinical = analyzeClinicalState(state);
  return [
    ...clinical.relations.map((relation) => ({
      title:
        relation.type === "trend" ? "Динамика" :
        relation.type === "same_measurement_different_document" ? "Расхождение записей" : "Связь",
      body: relation.explanation,
      sources: relation.sourceRefs,
    })),
    // Temporal coincidence alone is not a clinical relationship.
  ];
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
  return `${count} ${many}`;
}

function writtenDose(item: { doseText: string; unit: string; frequency?: string }): string {
  return `${item.doseText} ${item.unit}${item.frequency ? `, ${item.frequency}` : ""}`;
}

function sourceForMedication(state: OwnerState, item: MedicationMention): SourceRef {
  const document = state.documents.find((doc) => doc.id === item.documentId);
  return {
    documentId: item.documentId,
    documentName: document?.fileName ?? "документ",
    line: item.line,
    excerpt: item.excerpt,
  };
}

export function buildTimeline(state: OwnerState): TimelineEvent[] {
  const ready = new Set(state.documents.filter((item) => item.status === "ready").map((item) => item.id));
  const events: TimelineEvent[] = [];
  for (const fact of state.facts) {
    if (!ready.has(fact.documentId)) continue;
    const range =
      fact.referenceLow != null && fact.referenceHigh != null
        ? `, референс бланка ${fact.referenceLow}–${fact.referenceHigh}`
        : "";
    const mark =
      fact.status === "conflicting"
        ? " Запись спорная: число оставлено как в строке."
        : !fact.unit.trim() || fact.value < 0
          ? " Единица в строке не указана."
          : "";
    events.push({
      date: fact.date,
      dateStatus: fact.date ? "known" : "unknown",
      kind: "measurement",
      text: `${`${fact.label} ${fact.valueText} ${fact.unit}${range}`.replace(/[ \t]+/g, " ").trim().replace(/\.+$/u, "")}.${mark}`.replace(/[ \t]+/g, " ").trim(),
      source: sourceFor(state, fact),
    });
  }
  for (const item of state.medications) {
    if (!ready.has(item.documentId)) continue;
    events.push({
      date: item.date,
      dateStatus: item.date ? "known" : "unknown",
      kind: "medication",
      text: `В тексте: ${item.name} ${writtenDose(item)}.`,
      source: sourceForMedication(state, item),
    });
  }
  events.sort((left, right) => {
    if (left.date && right.date && left.date !== right.date) return left.date < right.date ? -1 : 1;
    if (left.date && !right.date) return -1;
    if (!left.date && right.date) return 1;
    if (left.source.line !== right.source.line) return left.source.line - right.source.line;
    return left.source.documentId < right.source.documentId ? -1 : left.source.documentId > right.source.documentId ? 1 : 0;
  });
  return events;
}

function sourceFor(state: OwnerState, fact: MedicalFact): SourceRef {
  const document = state.documents.find((item) => item.id === fact.documentId);
  return {
    documentId: fact.documentId,
    documentName: document?.fileName ?? "документ",
    line: fact.line,
    excerpt: fact.excerpt,
  };
}

function formatFact(fact: MedicalFact): string {
  const when = fact.date ? ` ${fact.date}` : "";
  const range =
    fact.referenceLow != null && fact.referenceHigh != null
      ? `, референс бланка ${fact.referenceLow}–${fact.referenceHigh}`
      : "";
  const original = fact.excerpt ? `. В документе: «${fact.excerpt}»` : "";
  const mark =
    fact.status === "conflicting"
      ? " Запись спорная: число оставлено как в строке."
      : fact.status === "uncertain"
        ? fact.date ? " Единица в строке не указана." : " Дата в документе не указана."
        : "";
  return `${fact.label} ${fact.valueText} ${fact.unit}${when}${range}${original}${mark}`.replace(/[ \t]+/g, " ").trim();
}

function classifyFacts(state: OwnerState): void {
  const groups = new Map<string, MedicalFact[]>();
  for (const fact of state.facts) {
    const key = `${fact.concept}|${fact.date ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(fact);
    groups.set(key, list);
  }
  const disputed = new Set<string>();
  for (const list of groups.values()) {
    if (new Set(list.map((fact) => fact.valueText)).size > 1) {
      for (const fact of list) disputed.add(fact.id);
    }
  }
  for (const issue of state.issues) {
    for (const fact of state.facts) {
      if (fact.documentId !== issue.documentId) continue;
      const sameLine = fact.line === issue.line || fact.line === issue.otherLine;
      const sameExcerpt = Boolean(fact.excerpt) && (fact.excerpt === issue.excerpt || fact.excerpt === issue.otherExcerpt);
      if (sameLine || sameExcerpt) disputed.add(fact.id);
    }
  }
  for (const fact of state.facts) {
    fact.dateStatus = fact.date ? "known" : "unknown";
    fact.extraction = "text";
    if (disputed.has(fact.id)) fact.status = "conflicting";
    else if (!fact.date || !fact.unit.trim() || fact.value < 0) fact.status = "uncertain";
    else fact.status = "extracted";
  }
}

function physicianQuestions(conflicts: ReportBlock[], gaps: string[]): string[] {
  const questions: string[] = [];
  for (const block of conflicts.slice(0, 3)) {
    const clause = block.body.split(". ")[0]?.replace(/\.$/, "") ?? block.body;
    questions.push(`Вопрос врачу: ${clause}. Какую запись считать рабочей?`);
  }
  for (const gap of gaps.slice(0, 2)) {
    questions.push(`Вопрос врачу: ${gap} Это пробел комплекта, не задание на обследование.`);
  }
  return questions;
}

function guidelineNote(state: OwnerState): string {
  return guidelineSentence(state.region);
}

function trends(state: OwnerState): ReportBlock[] {
  // The same validated series must drive both the axis panel and the narrative.
  // Never bypass unit, date and contradiction checks with a second trend algorithm.
  const analysis = analyzeClinicalState(state);
  return analysis.axes.filter(axis => axis.axisId !== "dose_over_time").flatMap(axis => axis.trends.map(trend => ({
    title: axis.facts.find(fact => trend.sourceRefs.some(ref => ref.documentId === fact.documentId && ref.line === fact.line))?.label ?? axis.title,
    body: trend.explanation.includes(": ") ? trend.explanation.split(": ").slice(1).join(": ") : trend.explanation,
    sources: trend.sourceRefs,
  })));
}

function doseChanges(state: OwnerState): ReportBlock[] {
  return reconcileMedications(state).changes.map(group => ({
    title: "Смена дозы",
    body: medicationChangeText(group),
    sources: group.mentions.map(item => sourceForMedication(state, item)),
  }));
}

function conflicts(state: OwnerState): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const issue of state.issues) {
    const document = state.documents.find((item) => item.id === issue.documentId);
    blocks.push({
      title: "Запись внутри документа",
      body: issue.description,
      sources: [
        {
          documentId: issue.documentId,
          documentName: document?.fileName ?? "документ",
          line: issue.line,
          excerpt: issue.excerpt,
        },
        ...(issue.otherLine
          ? [{
              documentId: issue.documentId,
              documentName: document?.fileName ?? "документ",
              line: issue.otherLine,
              excerpt: issue.otherExcerpt ?? "",
            }]
          : []),
      ],
    });
  }

  for (const group of reconcileMedications(state).conflicts) {
    blocks.push({
      title: "Разные дозы",
      body: medicationConflictText(group),
      sources: group.mentions.map(item => sourceForMedication(state, item)),
    });
  }

  const sameDay = new Map<string, MedicalFact[]>();
  for (const fact of state.facts) {
    const key = `${fact.concept}|${fact.date ?? "unknown"}|${fact.unit}`;
    const list = sameDay.get(key) ?? [];
    list.push(fact);
    sameDay.set(key, list);
  }
  for (const list of sameDay.values()) {
    const values = new Set(list.map((item) => item.value));
    if (values.size < 2 || list.length < 2) continue;
    const first = list[0];
    if (!first) continue;
    blocks.push({
      title: "Разные числа в одну дату",
      body: `${first.label} в документах с одной датой записан по-разному: ${list.map((item) => item.valueText).join(" и ")} ${first.unit}. Какое значение верное, разбор не решает.`,
      sources: list.map((item) => sourceFor(state, item)),
    });
  }
  return blocks;
}

export function buildReport(state: OwnerState): ReportView {
  const readable = state.documents.filter((item) => item.status === "ready");
  const inputHash = createHash("sha256")
    .update(JSON.stringify({
      region: state.region,
      docs: state.documents.map((item) => [item.id, item.contentHash, item.status, item.visualAnalysis ?? null]),
      facts: state.facts.map((item) => [item.documentId, item.concept, item.valueText, item.unit, item.date]),
      medications: state.medications.map((item) => [item.documentId, item.name, item.doseText, item.unit, item.frequency ?? "", item.date]),
      issues: state.issues.map((item) => [item.documentId, item.line, item.otherLine ?? 0, item.description]),
      pipeline: PIPELINE_VERSION,
    }))
    .digest("hex");

  const limits = [
    "Разбор объясняет медицинские документы, возможные причины изменений и направления лечения для обсуждения с врачом. Он не подтверждает диагноз и не назначает персональную схему лечения.",
  ];
  if (state.documents.some((item) => item.status === "anonymization_unconfirmed")) {
    limits.push("Снимки и DICOM сохранены отдельно. Текст на самом изображении здесь не проверяется, поэтому измерения с них не читаются.");
  }

  const imagingStudies = state.documents.filter(document => document.visualAnalysis).map(document => ({ documentId: document.id, documentName: document.fileName, status: document.visualAnalysis!.status, totalFrames: document.visualAnalysis!.totalFrames, analyzedFrames: document.visualAnalysis!.analyzedFrames, coverage: document.visualAnalysis!.coverage, limitations: document.visualAnalysis!.limitations }));
  const documents = state.documents.map((item) => ({ id: item.id, name: item.fileName, statusLabel: item.statusLabel, note: item.note }));
  const imageReadings = state.documents
    .filter((item) => item.anonymizedText.trim().startsWith("{"))
    .map((item) => ({ name: item.fileName, json: item.anonymizedText }));

  const pictures = state.documents.filter((item) => /\.(png|jpe?g|webp)$/i.test(item.fileName) && item.status === "anonymization_unconfirmed");

  if (readable.length === 0) {
    const pictureNote = pictures.length > 0 ? ` Снимки приложены отдельно: ${pictures.map((item) => item.fileName).join(", ")}. Числа с изображения не прочитаны.` : "";
    return {
      generatedAt: new Date().toISOString(),
      inputHash,
      region: state.region,
      pipelineVersion: PIPELINE_VERSION,
      status: state.documents.length === 0 ? "empty" : "ready",
      blockReasons: [],
      headline: state.documents.length === 0 ? "Разбор появится после документов" : pictures.length > 0 ? `Приложено ${plural(pictures.length, "снимок", "снимка", "снимков")}. Измерения с них не прочитаны.` : "Измерения из файлов не прочитаны",
      intro: state.documents.length === 0 ? "Загрузите бланк или выписку." : `Файлы сохранены, но строк с показателями в них не нашлось.${pictureNote}`,
      documents,
      guidelineNote: guidelineNote(state),
      catalog: catalogEntries(state.region),
      themes: [],
      changes: [],
      conflicts: [],
      gaps: [],
      questions: [],
      relationships: [],
      cannotSay: state.documents.length === 0 ? [] : ["Этот разбор не подтверждает диагноз и не определяет персональную схему лечения."],
      limits,
      imageReadings,
      imagingStudies,
      instrumentStudies: instrumentStudies(state),
      timeline: [],
    };
  }

  // Classify a detached snapshot so report generation never mutates source facts.
  const readyIds = new Set(readable.map(document => document.id));
  state = { ...state, facts: state.facts.filter(fact => readyIds.has(fact.documentId)).map(fact => ({ ...fact })), medications: state.medications.filter(item => readyIds.has(item.documentId)), issues: state.issues.filter(item => readyIds.has(item.documentId)) };
  classifyFacts(state);
  const clinical = analyzeClinicalState(state);
  const themes: ReportBlock[] = [];
  const gaps: string[] = [...reconcileMedications(state).missing];
  for (const axis of AXES.filter((item) => item.kind === "labs")) {
    const facts = state.facts.filter((fact) => axis.concepts.includes(fact.concept));
    const requiredMet = axis.required.every((concept) => facts.some((fact) => fact.concept === concept));
    if (facts.length === 0) {
      if (!axis.quietWhenEmpty && axis.gap) gaps.push(`Ось «${axis.title}»: ${axis.gap}`);
      continue;
    }
    if (!requiredMet) gaps.push(`Для темы «${axis.title}» основной показатель в документах не найден.`);
    themes.push({
      title: axis.title,
      lead: requiredMet
        ? "Данных по теме достаточно, чтобы прочитать записанные числа."
        : "По теме есть не все показатели.",
      body: facts.map(formatFact).join("\n"),
      sources: facts.map((fact) => sourceFor(state, fact)),
    });
  }

  if (state.medications.length > 0) {
    themes.push({
      title: "Препараты в тексте",
      lead: "Это цитаты документов, не схема приёма.",
      body: state.medications
        .map((item) => `${item.name} ${writtenDose(item)}${item.date ? `, ${item.date}` : ""}`)
        .join("\n"),
      sources: state.medications.map((item) => {
        const document = state.documents.find((doc) => doc.id === item.documentId);
        return {
          documentId: item.documentId,
          documentName: document?.fileName ?? "документ",
          line: item.line,
          excerpt: item.excerpt,
        };
      }),
    });
  }

  const conflictBlocks = conflicts(state);
  const changeBlocks = [...trends(state), ...doseChanges(state)];
  const relationshipBlocks = buildRelationships(state);
  const axisResults = clinical.axes.map((axis) => ({ axisId: axis.axisId, title: axis.title, status: axis.status, factCount: axis.facts.length, trendCount: axis.trends.length, conflictCount: axis.conflicts.length, missingCount: axis.missing.length }));
  const cannotSay = ["Этот разбор не подтверждает диагноз и не определяет персональную схему лечения."];
  if (state.documents.some((item) => item.status === "anonymization_unconfirmed")) {
    cannotSay.push("По снимку нельзя назвать измерения: текст на изображении не проверен.");
  }
  const questions = physicianQuestions(conflictBlocks, gaps);

  const parts = [
    `Прочитано ${plural(state.facts.length, "измерение", "измерения", "измерений")} из ${plural(readable.length, "документа", "документов", "документов")}.`,
  ];
  if (pictures.length > 0) parts.push(`Приложено ${plural(pictures.length, "снимок", "снимка", "снимков")}.`);
  if (conflictBlocks.length > 0) parts.push(`Есть ${plural(conflictBlocks.length, "расхождение", "расхождения", "расхождений")}.`);
  if (changeBlocks.length > 0) parts.push(`Динамика видна по ${plural(changeBlocks.length, "показателю", "показателям", "показателям")}.`);

  const report: ReportView = {
    generatedAt: new Date().toISOString(),
    inputHash,
    region: state.region,
    pipelineVersion: PIPELINE_VERSION,
    status: "ready",
    blockReasons: [],
    headline: parts.join(" "),
    intro: [
      `В разбор вошли: ${readable.map((item) => item.fileName).join(", ")}.`,
      pictures.length > 0 ? `Снимки приложены отдельно: ${pictures.map((item) => item.fileName).join(", ")}. Числа с изображения не прочитаны.` : "",
    ].filter(Boolean).join(" "),
    documents,
    guidelineNote: guidelineNote(state),
    catalog: catalogEntries(state.region),
    themes,
    changes: changeBlocks,
    conflicts: conflictBlocks,
    gaps,
    questions,
    relationships: relationshipBlocks,
    cannotSay,
    limits,
    imageReadings,
    imagingStudies,
    instrumentStudies: instrumentStudies(state),
    timeline: buildTimeline(state),
    axisResults,
  };
  return validateReport(report, state);
}

const FORBIDDEN = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо/i;

export function validateReport(report: ReportView, state: OwnerState): ReportView {
  const reasons: string[] = [];
  const prose = [
    report.headline,
    report.intro,
    report.guidelineNote,
    ...report.themes.map((item) => `${item.lead ?? ""}\n${item.body}`),
    ...report.changes.map((item) => item.body),
    ...report.conflicts.map((item) => item.body),
    ...report.relationships.map((item) => item.body),
    ...report.gaps,
    ...report.questions,
    ...report.cannotSay,
    ...report.limits,
    ...(report.timeline ?? []).map((item) => item.text),
  ].join("\n");

  if (FORBIDDEN.test(prose)) reasons.push("В тексте есть формулировка за границей справки.");

  const allowedDoses = new Set(state.medications.map((item) => item.doseText));
  for (const match of prose.matchAll(/(\d+(?:[.,]\d+)?)\s*(мг|мкг)(?![\p{L}\p{N}])/giu)) {
    const dose = match[1]?.replace(",", ".");
    if (dose && !allowedDoses.has(dose)) reasons.push("В тексте есть доза, которой нет в документах.");
  }

  const catalog = guidelinesFor(report.region);
  for (const item of catalog) {
    if (!item.supersededBy) continue;
    const calledCurrent = new RegExp(
      `актуальн\\p{L}*\\s+верси\\p{L}*\\s+${item.version}|(?:^|\\s)верси\\p{L}*\\s+${item.version}\\s+актуальн`,
      "iu",
    );
    if (calledCurrent.test(prose)) reasons.push("Устаревшая версия рекомендации названа актуальной.");
  }

  const allowed = new Set<string>();
  for (const fact of state.facts) {
    allowed.add(fact.valueText);
    if (fact.referenceLow != null) allowed.add(String(fact.referenceLow));
    if (fact.referenceHigh != null) allowed.add(String(fact.referenceHigh));
  }
  for (const medication of state.medications) allowed.add(medication.doseText);
  for (const guideline of guidelinesFor(report.region)) {
    allowed.add(guideline.version);
    allowed.add(guideline.publicationDate.slice(0, 4));
    for (const target of guideline.targets ?? []) {
      const shown = new RegExp(`${String(target.value).replace(".", "[.,]")}\\s*ммоль/л`, "i").test(prose);
      const inFacts = state.facts.some((fact) => fact.concept === target.concept && fact.value === target.value);
      if (shown && !inFacts) reasons.push("В тексте есть целевой показатель не из документов.");
    }
  }
  const clinical = [
    ...[...report.themes, ...report.changes, ...report.conflicts, ...report.relationships].map((item) => item.body),
    ...(report.timeline ?? []).map((item) => item.text),
  ].join("\n");
  const withoutDates = clinical.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  for (const match of withoutDates.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ммоль\/л|г\/л|мм|Ед\/л|мг|мкг)/giu)) {
    const value = match[1]?.replace(",", ".");
    if (value && !allowed.has(value) && !allowed.has(match[1] ?? "")) reasons.push("В тексте есть число, которого нет в документах.");
  }
  for (const issue of state.issues) {
    const shown = report.conflicts.some((block) => block.body.includes(issue.description.slice(0, 24)));
    if (!shown) reasons.push("Ошибка документа не попала в текст разбора.");
  }
  const confirmed = state.documents.filter((item) => item.status === "ready");
  if (confirmed.some((item) => identityLeft(item.anonymizedText))) {
    reasons.push("Обезличивание файла не подтверждено.");
  }

  if (reasons.length === 0) return report;
  return {
    ...report,
    status: "blocked",
    blockReasons: [...new Set(reasons)],
    headline: "Отчёт не прошёл проверку",
    intro: "Проверка остановила текст до выдачи.",
    themes: [],
    changes: [],
    conflicts: [],
    relationships: [],
    gaps: [],
    questions: [],
    cannotSay: [],
    timeline: [],
    guidelineNote: "",
    imageReadings: [],
    wording: [],
  };
}
