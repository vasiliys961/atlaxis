import { createHash } from "crypto";
import { AXES } from "./catalog";
import { currentGuidelines, guidelinesFor } from "./guidelines";
import { PIPELINE_VERSION, type MedicalFact, type OwnerState, type ReportBlock, type ReportView, type SourceRef } from "./types";

function observedTogether(conflictBlocks: ReportBlock[], changeBlocks: ReportBlock[]): ReportBlock[] {
  const dose = conflictBlocks.find((block) => block.title === "Разные дозы");
  if (!dose) return [];
  const shared = changeBlocks.filter((change) => change.sources.some((source) => dose.sources.some((item) => item.documentId === source.documentId)));
  if (shared.length === 0) return [];
  return [
    {
      title: "Что попало в одни и те же документы",
      body: "В тех же документах, где указаны разные дозы, меняется и лабораторный показатель. Разбор не считает это причиной.",
      sources: [...dose.sources, ...shared.flatMap((block) => block.sources)],
    },
  ];
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
  return `${count} ${many}`;
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
  return `${fact.label} ${fact.valueText} ${fact.unit}${when}${range}`.replace(/\s+/g, " ").trim();
}

function guidelineNote(state: OwnerState): string {
  const regionName = state.region === "RU" ? "России" : state.region === "EU" ? "Европы" : "США";
  const all = guidelinesFor(state.region);
  const current = currentGuidelines(state.region);
  if (all.length === 0) {
    return `Для ${regionName} в каталоге этой поставки нет записи, которую можно процитировать. Целевые показатели не подставлены.`;
  }
  const used = current.map((item) => `${item.organization}, ${item.title}, версия ${item.version}`).join("; ");
  const older = all.filter((item) => item.supersededBy);
  const olderNote =
    older.length > 0
      ? ` Более ранняя версия ${older.map((item) => item.version).join(", ")} в каталоге сохранена и актуальной не считается.`
      : "";
  return `Разбор смотрит каталог для ${regionName}: ${used}.${olderNote} Числовой цели в отчёте нет: в документах не указана группа, для которой источник задаёт цель.`;
}

function trends(state: OwnerState): ReportBlock[] {
  const groups = new Map<string, MedicalFact[]>();
  for (const fact of state.facts) {
    const list = groups.get(fact.concept) ?? [];
    list.push(fact);
    groups.set(fact.concept, list);
  }
  const blocks: ReportBlock[] = [];
  for (const list of groups.values()) {
    const dated = list.filter((fact) => fact.date).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    if (dated.length < 2) continue;
    const first = dated[0];
    const last = dated[dated.length - 1];
    if (!first || !last || first.unit !== last.unit) continue;
    const direction = last.value > first.value ? "выросло" : last.value < first.value ? "снизилось" : "не изменилось";
    blocks.push({
      title: first.label,
      body: `${first.valueText} ${first.unit} (${first.date}), затем ${last.valueText} ${last.unit} (${last.date}). Значение ${direction}. Это две точки из документов, без вывода о причине.`,
      sources: [sourceFor(state, first), sourceFor(state, last)],
    });
  }
  return blocks;
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
      ],
    });
  }

  const byDrug = new Map<string, typeof state.medications>();
  for (const mention of state.medications) {
    const key = `${mention.name}|${mention.unit}`;
    const list = byDrug.get(key) ?? [];
    list.push(mention);
    byDrug.set(key, list);
  }
  for (const list of byDrug.values()) {
    const doses = new Set(list.map((item) => item.dose));
    if (doses.size < 2) continue;
    const first = list[0];
    if (!first) continue;
    const written = list
      .map((item) => `${item.doseText} ${item.unit}${item.date ? ` (${item.date})` : ""}`)
      .join(" и ");
    blocks.push({
      title: "Разные дозы",
      body: `Для «${first.name}» в документах указаны разные дозы: ${written}. Разбор оставляет обе записи как есть.`,
      sources: list.map((item) => {
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
    .update(JSON.stringify({ region: state.region, docs: state.documents.map((item) => [item.id, item.contentHash]), pipeline: PIPELINE_VERSION }))
    .digest("hex");

  const limits = [
    "Это справочный разбор загруженных документов. Он не ставит диагноз и не назначает лечение.",
  ];
  if (state.documents.some((item) => item.status === "anonymization_unconfirmed")) {
    limits.push("Снимки и DICOM сохранены отдельно. Текст на самом изображении здесь не проверяется, поэтому измерения с них не читаются.");
  }

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
      intro: state.documents.length === 0 ? "Загрузите бланк, выписку или откройте пример." : `Файлы сохранены, но строк с показателями в них не нашлось.${pictureNote}`,
      documents,
      guidelineNote: guidelineNote(state),
      themes: [],
      changes: [],
      conflicts: [],
      gaps: [],
      questions: [],
      relationships: [],
      cannotSay: state.documents.length === 0 ? [] : ["По этим документам нельзя назвать диагноз или схему лечения."],
      limits,
      imageReadings,
    };
  }

  const themes: ReportBlock[] = [];
  const gaps: string[] = [];
  for (const axis of AXES.filter((item) => item.kind === "labs")) {
    const facts = state.facts.filter((fact) => axis.concepts.includes(fact.concept));
    const requiredMet = axis.required.every((concept) => facts.some((fact) => fact.concept === concept));
    if (facts.length === 0) {
      gaps.push(axis.gap);
      continue;
    }
    if (!requiredMet) gaps.push(`Для темы «${axis.title}» основной показатель в документах не найден.`);
    themes.push({
      title: axis.title,
      body: facts.map(formatFact).join("\n"),
      sources: facts.map((fact) => sourceFor(state, fact)),
    });
  }

  if (state.medications.length > 0) {
    themes.push({
      title: "Препараты в тексте",
      body: `${state.medications
        .map((item) => `${item.name} ${item.doseText} ${item.unit}${item.date ? `, ${item.date}` : ""}`)
        .join("\n")}\nЭто цитаты документов, не схема приёма.`,
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
  const changeBlocks = trends(state);
  const relationshipBlocks = observedTogether(conflictBlocks, changeBlocks);
  const cannotSay = ["По этим документам нельзя назвать диагноз или схему лечения."];
  if (state.documents.some((item) => item.status === "anonymization_unconfirmed")) {
    cannotSay.push("По снимку нельзя назвать измерения: текст на изображении не проверен.");
  }
  const questions: string[] = [];
  if (conflictBlocks.length > 0) {
    questions.push("На приёме можно показать места, где документы не сходятся, и спросить, какую запись считать рабочей.");
  }
  if (gaps.length > 0) {
    questions.push("Можно показать врачу, каких данных в загруженном комплекте нет.");
  }

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
    themes,
    changes: changeBlocks,
    conflicts: conflictBlocks,
    gaps,
    questions,
    relationships: relationshipBlocks,
    cannotSay,
    limits,
    imageReadings,
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
    ...report.themes.map((item) => item.body),
    ...report.changes.map((item) => item.body),
    ...report.conflicts.map((item) => item.body),
    ...report.relationships.map((item) => item.body),
    ...report.gaps,
    ...report.questions,
    ...report.cannotSay,
    ...report.limits,
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
  const clinical = [...report.themes, ...report.changes, ...report.conflicts, ...report.relationships].map((item) => item.body).join("\n");
  const withoutDates = clinical.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  for (const match of withoutDates.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ммоль\/л|г\/л|мм|Ед\/л|мг|мкг)/giu)) {
    const value = match[1]?.replace(",", ".");
    if (value && !allowed.has(value) && !allowed.has(match[1] ?? "")) reasons.push("В тексте есть число, которого нет в документах.");
  }
  for (const issue of state.issues) {
    const shown = report.conflicts.some((block) => block.body.includes(issue.description.slice(0, 24)));
    if (!shown) reasons.push("Ошибка документа не попала в текст разбора.");
  }

  if (reasons.length === 0) return report;
  return {
    ...report,
    status: "blocked",
    blockReasons: [...new Set(reasons)],
    headline: "Разбор не показан",
    intro: "Проверка остановила текст до выдачи.",
    themes: [],
    changes: [],
    conflicts: [],
    relationships: [],
    gaps: [],
    questions: [],
    cannotSay: [],
    guidelineNote: "",
    imageReadings: [],
    wording: [],
  };
}
