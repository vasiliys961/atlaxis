import { createHash } from "crypto";
import { AXES } from "./catalog";
import { catalogEntries, guidelineSentence, guidelinesFor } from "./guidelines";
import { PIPELINE_VERSION, type MedicalFact, type OwnerState, type ReportBlock, type ReportView, type SourceRef } from "./types";

function periodLinks(state: OwnerState): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const seen = new Set<string>();
  for (const medication of state.medications) {
    if (!medication.date) continue;
    const month = medication.date.slice(0, 7);
    const fact = state.facts.find((item) => item.date?.slice(0, 7) === month);
    if (!fact?.date) continue;
    const key = `${medication.name}|${month}|${fact.concept}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const document = state.documents.find((item) => item.id === medication.documentId);
    blocks.push({
      title: "В тот же период",
      body: `В тот же период, ${month}, в документах есть и «${medication.name}», и ${fact.label}. Ясной связи разбор не называет.`,
      sources: [
        sourceFor(state, fact),
        {
          documentId: medication.documentId,
          documentName: document?.fileName ?? "документ",
          line: medication.line,
          excerpt: medication.excerpt,
        },
      ],
    });
  }
  return blocks;
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

function doseChanges(state: OwnerState): ReportBlock[] {
  const byDrug = new Map<string, typeof state.medications>();
  for (const mention of state.medications) {
    const key = `${mention.name}|${mention.unit}`;
    const list = byDrug.get(key) ?? [];
    list.push(mention);
    byDrug.set(key, list);
  }
  const blocks: ReportBlock[] = [];
  for (const list of byDrug.values()) {
    const dated = list.filter((item) => item.date).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const sameDate = new Map<string, typeof dated>();
    const sameDocument = new Map<string, typeof dated>();
    for (const item of dated) {
      const atDate = sameDate.get(item.date ?? "") ?? [];
      atDate.push(item);
      sameDate.set(item.date ?? "", atDate);
      const inDocument = sameDocument.get(item.documentId) ?? [];
      inDocument.push(item);
      sameDocument.set(item.documentId, inDocument);
    }
    const clashes =
      [...sameDate.values()].some((group) => new Set(group.map((item) => item.dose)).size > 1) ||
      [...sameDocument.values()].some((group) => new Set(group.map((item) => item.dose)).size > 1);
    if (clashes) continue;
    if (new Set(dated.map((item) => item.dose)).size < 2 || new Set(dated.map((item) => item.date)).size < 2) continue;
    const first = dated[0];
    if (!first) continue;
    blocks.push({
      title: "Смена дозы",
      body: `Для «${first.name}» в разные даты записаны разные дозы: ${dated.map((item) => `${writtenDose(item)} (${item.date})`).join(", затем ")}. Это смена записи во времени, не спор об одной дате.`,
      sources: dated.map((item) => {
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

  const byDrug = new Map<string, typeof state.medications>();
  for (const mention of state.medications) {
    const key = `${mention.name}|${mention.unit}`;
    const list = byDrug.get(key) ?? [];
    list.push(mention);
    byDrug.set(key, list);
  }
  for (const list of byDrug.values()) {
    const disputed = new Map<string, (typeof list)[number]>();
    const remember = (item: (typeof list)[number]) => disputed.set(item.id, item);
    const byDate = new Map<string, typeof list>();
    const byDocument = new Map<string, typeof list>();
    for (const item of list) {
      if (item.date) {
        const dated = byDate.get(item.date) ?? [];
        dated.push(item);
        byDate.set(item.date, dated);
      }
      const inDocument = byDocument.get(item.documentId) ?? [];
      inDocument.push(item);
      byDocument.set(item.documentId, inDocument);
    }
    for (const dated of byDate.values()) {
      if (new Set(dated.map((item) => item.dose)).size > 1) dated.forEach(remember);
    }
    for (const inDocument of byDocument.values()) {
      if (new Set(inDocument.map((item) => item.dose)).size > 1) inDocument.forEach(remember);
    }
    const clash = [...disputed.values()];
    const first = list[0];
    if (!first) continue;
    if (clash.length > 0) {
      const written = clash.map((item) => `${writtenDose(item)}${item.date ? ` (${item.date})` : ""}`).join(" и ");
      blocks.push({
        title: "Разные дозы",
        body: `Для «${first.name}» разные дозы относятся к одной дате или к одному документу: ${written}. Разбор оставляет обе записи как есть.`,
        sources: clash.map((item) => {
          const document = state.documents.find((doc) => doc.id === item.documentId);
          return {
            documentId: item.documentId,
            documentName: document?.fileName ?? "документ",
            line: item.line,
            excerpt: item.excerpt,
          };
        }),
      });
      continue;
    }
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
      docs: state.documents.map((item) => [item.id, item.contentHash, item.status]),
      facts: state.facts.map((item) => [item.documentId, item.concept, item.valueText, item.unit, item.date]),
      medications: state.medications.map((item) => [item.documentId, item.name, item.doseText, item.unit, item.frequency ?? "", item.date]),
      issues: state.issues.map((item) => [item.documentId, item.line, item.otherLine ?? 0, item.description]),
      pipeline: PIPELINE_VERSION,
    }))
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
      catalog: catalogEntries(state.region),
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

  classifyFacts(state);
  const themes: ReportBlock[] = [];
  const gaps: string[] = [];
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
  const relationshipBlocks = periodLinks(state);
  const cannotSay = ["По этим документам нельзя назвать диагноз или схему лечения."];
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
