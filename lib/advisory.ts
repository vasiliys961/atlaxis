import { AXES } from "./catalog";
import { analyzeClinicalState } from "./clinical-engine";
import { parseDocument } from "./parse";
import type {
  AdvisoryIssue,
  AdvisoryPriority,
  AdvisoryView,
  MedicalFact,
  OwnerState,
  SourceRef,
} from "./types";

type Deviation = "below" | "above" | "within" | "unknown";

const DISCUSSION_BY_AXIS: Record<string, string[]> = {
  blood_pressure: [
    "Как оценивать эти значения с учётом условий измерения и домашней динамики?",
    "Нужны ли повторные измерения в сопоставимых условиях?",
  ],
  lipid_profile: [
    "Как эти показатели соотносятся с общим сердечно-сосудистым риском?",
    "Какие причины и сопутствующие факторы важно учесть перед выбором дальнейшей тактики?",
  ],
  glucose: [
    "Важно ли время забора и состояние натощак для интерпретации этой записи?",
    "Нужна ли проверка показателя в динамике или другим методом?",
  ],
  renal_function: [
    "Как читать показатели функции почек с учётом возраста, массы тела, лекарств и динамики?",
    "Какие сопутствующие показатели нужны для уточнения функции почек?",
  ],
  liver_enzymes: [
    "Нужно ли сопоставить билирубин с его фракциями и печёночными ферментами в динамике?",
    "Какие лекарства, добавки, питание, симптомы и данные УЗИ важны для интерпретации?",
  ],
  blood_count: [
    "Нужно ли оценивать эти строки вместе с эритроцитарными индексами, лейкоформулой и прежними анализами?",
  ],
  thyroid_function: [
    "Как интерпретировать показатели щитовидной железы вместе с симптомами, лекарствами и свободным Т4?",
  ],
  inflammation_markers: [
    "Есть ли клинические симптомы или другие маркеры, которые меняют значение этой записи?",
  ],
  iron_stores: [
    "Как сопоставить этот показатель с гемоглобином, эритроцитарными индексами и признаками воспаления?",
  ],
  electrolytes: [
    "Могли ли лекарства, питание, обезвоживание или условия забора повлиять на результат?",
  ],
  vitamin_d: [
    "Как учитывать сезон, приём добавок и прежние значения при оценке динамики?",
  ],
  zinc: [
    "Насколько показатель сопоставим с предыдущими анализами по материалу, времени и условиям забора?",
  ],
};

const CONSIDERATIONS_BY_AXIS: Record<string, string[]> = {
  blood_pressure: [
    "Обсуждают устойчивое повышение давления, влияние боли, стресса, кофеина, лекарств и техники измерения.",
  ],
  lipid_profile: [
    "Обсуждают питание и массу тела, наследственные особенности обмена липидов, функцию щитовидной железы, сахарный обмен, печень, почки и влияние лекарств.",
  ],
  glucose: [
    "Обсуждают условия забора, недавнюю еду или острое состояние, нарушения углеводного обмена и влияние лекарств.",
  ],
  renal_function: [
    "Обсуждают обезвоживание, мышечную массу, лекарства, острые и хронические изменения функции почек; одного показателя для вывода недостаточно.",
  ],
  liver_enzymes: [
    "Для билирубина и печёночных показателей обсуждают условия забора и голодание, лекарства и добавки, усиленный распад эритроцитов, особенности обмена билирубина, состояние печени и желчных путей.",
  ],
  blood_count: [
    "В зависимости от изменённой строки обсуждают дефицитные состояния, кровопотерю, воспаление или инфекцию, влияние лекарств и особенности кроветворения.",
  ],
  thyroid_function: [
    "Обсуждают функцию щитовидной железы, влияние лекарств, беременности или острого состояния; ТТГ интерпретируют вместе со свободным Т4 и симптомами.",
  ],
  inflammation_markers: [
    "Обсуждают инфекционные и неинфекционные причины воспалительной реакции, но неспецифический маркер сам по себе не устанавливает заболевание.",
  ],
  iron_stores: [
    "Обсуждают дефицит железа, воспаление, кровопотерю и особенности питания; ферритин оценивают вместе с анализом крови и маркерами воспаления.",
  ],
  electrolytes: [
    "Обсуждают водный баланс, функцию почек и надпочечников, питание, потери жидкости и влияние лекарств.",
  ],
  vitamin_d: [
    "Обсуждают сезонность, питание, приём добавок, всасывание и сопутствующие состояния; единичное значение оценивают в клиническом контексте.",
  ],
  zinc: [
    "Обсуждают питание, всасывание, воспаление, потери и условия забора; сывороточный цинк чувствителен к контексту исследования.",
  ],
};

function sourceFor(state: OwnerState, fact: MedicalFact): SourceRef {
  return {
    documentId: fact.documentId,
    documentName: state.documents.find((document) => document.id === fact.documentId)?.fileName ?? "документ",
    line: fact.line,
    excerpt: fact.excerpt,
  };
}

function deviation(fact: MedicalFact): Deviation {
  if (fact.referenceLow != null && fact.value < fact.referenceLow) return "below";
  if (fact.referenceHigh != null && fact.value > fact.referenceHigh) return "above";
  if (fact.referenceLow != null || fact.referenceHigh != null) return "within";
  return "unknown";
}

function barelyOutside(fact: MedicalFact): boolean {
  if (fact.referenceHigh != null && fact.value > fact.referenceHigh && fact.referenceHigh > 0) {
    return fact.value <= fact.referenceHigh * 1.1;
  }
  if (fact.referenceLow != null && fact.value < fact.referenceLow && fact.referenceLow > 0) {
    return fact.value >= fact.referenceLow * 0.9;
  }
  return false;
}

function findingText(fact: MedicalFact): string {
  const status = deviation(fact);
  const range =
    fact.referenceLow != null && fact.referenceHigh != null
      ? `${fact.referenceLow}–${fact.referenceHigh} ${fact.unit}`
      : fact.referenceLow != null
        ? `от ${fact.referenceLow} ${fact.unit}`
        : fact.referenceHigh != null
          ? `до ${fact.referenceHigh} ${fact.unit}`
          : "";
  const interpretation =
    status === "above"
      ? `выше верхней границы${range ? ` ${range}` : ""}`
      : status === "below"
        ? `ниже нижней границы${range ? ` ${range}` : ""}`
        : status === "within"
          ? `в пределах указанного диапазона${range ? ` ${range}` : ""}`
          : "без числового референса в строке";
  return `${fact.label}: ${fact.valueText} ${fact.unit}${fact.date ? ` (${fact.date})` : ""} — ${interpretation}.`;
}

function uniqueSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.documentId}:${source.line}:${source.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textLines(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { lines?: unknown };
      if (Array.isArray(parsed.lines)) return parsed.lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
    } catch {
      // Plain text falls through.
    }
  }
  return text.split(/\n/).map((line) => line.trim()).filter(Boolean);
}

function observedState(state: OwnerState): OwnerState {
  const facts: MedicalFact[] = [];
  for (const document of state.documents) {
    if (document.status !== "ready") continue;
    for (const fact of parseDocument(textLines(document.anonymizedText).join("\n")).facts) {
      facts.push({ ...fact, id: `${document.id}:${fact.line}:${fact.concept}`, documentId: document.id });
    }
  }
  return facts.length ? { ...state, facts } : state;
}

function imagingIssues(state: OwnerState): AdvisoryIssue[] {
  const issues: AdvisoryIssue[] = [];
  for (const document of state.documents) {
    if (document.status !== "ready") continue;
    const lines = textLines(document.anonymizedText);
    lines.forEach((line, index) => {
      if (!/заключен/iu.test(line) || /не является диагнозом|требует интерпретации/iu.test(line)) return;
      if (!/полип|пристеночн|образован|кист|конкремент/iu.test(line)) return;
      const descriptionAt = lines.findIndex((item) => item !== line && /полип|пристеночн/iu.test(item));
      const description = descriptionAt >= 0 ? lines.slice(Math.max(0, descriptionAt - 1), descriptionAt + 2).join(" ") : "";
      const finding = [line, description].filter(Boolean).join(" ");
      issues.push({
        id: `imaging-${document.id}-${index + 1}`,
        title: /полип|желчн/iu.test(finding) ? "Желчный пузырь" : "Заключение исследования",
        summary: "В документе есть врачебное заключение. Его читают вместе с описанием и лабораторными находками, а не как отдельный диагноз сервиса.",
        findings: [finding.replace(/\s+/g, " ")],
        considerations: [
          "Небольшое пристеночное образование желчного пузыря обычно обсуждают по размеру, росту в динамике, симптомам и описанию стенки. Заключение УЗИ называет находку, но не доказывает её природу.",
          "Такую находку не соединяют автоматически с изменением билирубина: сопоставляют фракции билирубина, лекарства, питание, симптомы и само описание УЗИ.",
        ],
        questions: [
          "Есть ли боль, тошнота или связь с едой, и менялся ли размер образования на прошлых исследованиях?",
          "Нужен ли плановый контроль УЗИ — это решает врач по размеру, симптомам и динамике.",
        ],
        sources: [{
          documentId: document.id,
          documentName: document.fileName,
          line: index + 1,
          excerpt: line.slice(0, 180),
        }],
      });
    });
  }
  return issues;
}

export function advisoryNarrative(advisory: AdvisoryView): string {
  const discussion = advisory.issues.slice(0, 4).map((issue) => {
    const finding = issue.findings.find((item) => /выше|ниже|заключен|полип|образован/iu.test(item)) ?? issue.findings[0];
    return [issue.title, finding, issue.considerations[0], issue.questions[0]].filter(Boolean).join(" ");
  });
  return [...new Set([advisory.summary, ...discussion, "Это возможные направления разговора с врачом, а не диагноз и не назначение."])].join(" ");
}

export function buildAdvisory(state: OwnerState): AdvisoryView {
  const source = observedState(state);
  const clinical = analyzeClinicalState(source);
  const priorities: AdvisoryPriority[] = [];
  const issues: AdvisoryIssue[] = [];
  const abnormalTitles: string[] = [];

  for (const axis of AXES.filter((item) => item.kind === "labs")) {
    const result = clinical.axes.find((item) => item.axisId === axis.id);
    if (!result?.facts.length) continue;
    const abnormal = result.facts.filter((fact) => ["above", "below"].includes(deviation(fact)));
    const uncertain = result.facts.filter((fact) => fact.status === "conflicting");
    if (!abnormal.length && !result.trends.length && !result.conflicts.length && !uncertain.length) continue;

    if (abnormal.some((fact) => fact.concept.startsWith("BILI"))) abnormalTitles.push("билирубин выше референса бланка");
    else if (abnormal.length && abnormal.every(barelyOutside)) abnormalTitles.push(`${axis.title} у границы референса одного бланка`);
    else if (abnormal.length) abnormalTitles.push(axis.title);
    const compared = result.facts.filter((fact) => abnormal.some((item) => item.concept === fact.concept) && deviation(fact) === "within");
    const findings = [
      ...abnormal.map(findingText),
      ...compared.slice(0, 2).map(findingText),
      ...result.trends.map((trend) => `Динамика: ${trend.explanation}`),
      ...(abnormal.length ? [] : result.conflicts.map((conflict) => conflict.explanation)),
      ...(abnormal.length ? [] : uncertain.slice(0, 2).map((fact) => `${fact.label}: строка неоднозначна, её читают вместе с соседними результатами.`)),
    ];
    const sources = uniqueSources([
      ...abnormal.map((fact) => sourceFor(state, fact)),
      ...uncertain.map((fact) => sourceFor(state, fact)),
      ...result.trends.flatMap((trend) => trend.sourceRefs),
      ...result.conflicts.flatMap((conflict) => conflict.sourceRefs),
    ]);
    const questions = DISCUSSION_BY_AXIS[axis.id] ?? [
      "Как это отклонение интерпретировать вместе с симптомами, лекарствами и предыдущими результатами?",
      "Какая проверка в динамике или дополнительный контекст нужны для уточнения?",
    ];
    const considerations = CONSIDERATIONS_BY_AXIS[axis.id] ?? [
      "Возможны как временные и преданалитические причины, так и состояния соответствующей системы; различить их можно только по симптомам, анамнезу, динамике и дополнительным данным.",
    ];
    const summary = [
      abnormal.length ? `${abnormal.length} ${abnormal.length === 1 ? "значение выходит" : "значения выходят"} за референс бланка.` : "",
      result.trends.length ? "Есть изменение между датами." : "",
      !abnormal.length && (result.conflicts.length || uncertain.length) ? "Часть строк неоднозначна, поэтому вывод опирают на остальные сопоставимые результаты." : "",
    ].filter(Boolean).join(" ");
    issues.push({ id: axis.id, title: axis.title, summary, findings, considerations, questions, sources });

    if (abnormal.length) {
      priorities.push({
        id: `${axis.id}-attention`,
        level: "attention",
        title: axis.title,
        summary: abnormal.map(findingText).join(" "),
        sources: abnormal.map((fact) => sourceFor(state, fact)),
      });
    } else if (result.trends.length) {
      priorities.push({
        id: `${axis.id}-follow-up`,
        level: "follow_up",
        title: `Динамика: ${axis.title}`,
        summary: result.trends.map((trend) => trend.explanation).join(" "),
        sources: result.trends.flatMap((trend) => trend.sourceRefs),
      });
    }
  }

  issues.push(...imagingIssues(state));
  for (const issue of issues.filter((item) => item.id.startsWith("imaging-"))) {
    if (!/полип|желчн/iu.test(issue.findings.join(" "))) continue;
    abnormalTitles.push("полип желчного пузыря в заключении УЗИ");
    priorities.push({
      id: `${issue.id}-attention`,
      level: "attention",
      title: issue.title,
      summary: issue.findings[0] ?? issue.summary,
      sources: issue.sources,
    });
  }

  const attention = priorities.filter((item) => item.level === "attention");
  const followUp = priorities.filter((item) => item.level === "follow_up");
  const topics = [...new Set(abnormalTitles)];
  const mainTopics = topics.filter((topic) => !topic.includes("у границы"));
  const edgeTopics = topics.filter((topic) => topic.includes("у границы"));
  const linked = topics.some((topic) => topic.includes("билирубин")) && topics.some((topic) => topic.includes("полип"))
    ? " Повышение билирубина и находку в желчном пузыре нельзя автоматически считать одной болезнью: сопоставляют фракции билирубина, симптомы, лекарства и описание УЗИ."
    : "";
  const edgeNote = mainTopics.length && edgeTopics.length ? ` Отдельно и мягче: ${edgeTopics.join("; ")}.` : "";
  const summary = topics.length
    ? `По загруженным документам обсуждать стоит вот что: ${(mainTopics.length ? mainTopics : edgeTopics).join("; ")}.${linked}${edgeNote} Ниже — какие причины обычно рассматривают и что уточнить с врачом. Это не диагноз.`
    : issues.length
      ? "Сопоставимые показатели не выходят за референсы своих бланков. Есть динамика или неоднозначные строки: их смысл зависит от симптомов, лекарств и условий забора, а не от повторной сверки каждой строки."
      : "По распознанным числовым строкам выходов за указанные на бланках референсы и сопоставимой динамики не найдено.";

  const plan = [
    issues.length
      ? { title: "О чём можно думать", items: [...new Set(issues.flatMap((issue) => issue.considerations))].slice(0, 6) }
      : null,
    attention.length || followUp.length
      ? { title: "Что обсудить с врачом", items: [...new Set(issues.flatMap((issue) => issue.questions))].slice(0, 6) }
      : null,
  ].filter((section): section is { title: string; items: string[] } => Boolean(section?.items.length));

  return { summary, priorities: [...attention, ...followUp], issues, plan };
}
