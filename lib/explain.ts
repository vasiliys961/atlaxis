import { catalogEntries, targetMark } from "./guidelines";
import { LUNA, OPUS, SONNET } from "./models";
import { polzaKey, polzaText } from "./polza";
import { decideProcessing } from "./policy";
import { buildReport } from "./report";
import { lunaPrompt, readLuna, routeQuestion, SAFETY_MEDS, SAFETY_URGENT } from "./router";
import type { ChatTurn, OwnerState, ReportView } from "./types";
import { acceptWording } from "./wording";

export const EXPLAIN_SYSTEM = `Ты отвечаешь с компетенцией профессора медицины из Doctor Opus: доказательная медицина, точная структура, сначала прямой ответ, затем плотное разъяснение терминов простым языком.

Единственная задача — рекомендации по уже полученным сведениям.
Рекомендация здесь — это разъяснение: что написано в документах, как значение соотносится с референсом бланка, что изменилось между датами, чего в комплекте нет и что стоит показать врачу. Если есть проверенная комплексная интерпретация, объясни её диагностические версии, альтернативы, направления лечения и практические советы. Не своди обсуждение всего комплекта к липидам или одной теме. Не добавляй новых гипотез и лечебных советов вне проверенной интерпретации.

Не ставь диагноз. Не назначай и не отменяй лечение, препараты, дозы и схемы.
Не придумывай числа, цели и дозы, которых нет в сведениях ниже.
Не пиши «сдайте анализ» и «вам необходимо».
Когда сравниваешь сведения с рекомендациями, опирайся только на самые последние данные из найденного поиска и из текущих записей каталога. Более раннюю редакцию не называй.
Если сведений мало, скажи об этом и задай один точный вопрос.
Пиши по-русски, плотно, законченными абзацами. Без решёток, таблиц, списков со звёздами и без канцелярита.`;

const TREATMENT = /ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|отмените|схема лечения|терапевтическ(?:ая|ую) доз/i;
const FINDING_MARK = "Обсудить находку:";
const SHEET_MARK = "Обсудить весь разбор:";

export function findingBrief(question: string): string {
  if (!question.startsWith(FINDING_MARK)) return "";
  return "Это одна находка с листа. Поясни только её: что записано, какой референс рядом и какая отметка уже стоит в строке. Числа повторяй только из находки и из сведений. Новую разницу, процент, диагноз и назначение не добавляй.";
}

export function sheetBrief(question: string): string {
  if (!question.startsWith(SHEET_MARK)) return "";
  return "Это весь комплект. Объясни взаимосвязи разных систем, динамику, расхождения и недостающие данные. Используй только уже проверенные диагностические версии и направления лечения, если они представлены. Сохрани их предварительный статус и ограничения. Не добавляй новых диагнозов, персональных назначений и чисел.";
}

function dossier(report: ReportView): string {
  const synthesis = report.clinicalSynthesis?.status === "ready" ? report.clinicalSynthesis : null;
  return [
    report.headline,
    report.intro,
    report.guidelineNote,
    ...(synthesis ? ["Проверенная комплексная интерпретация:", JSON.stringify({ overview: synthesis.overview, hypotheses: synthesis.hypotheses, treatmentDirections: synthesis.treatmentDirections, practicalAdvice: synthesis.practicalAdvice, missingContext: synthesis.missingContext })] : []),
    ...catalogEntries(report.region).map((item) => `${item.place}. ${item.organization}, версия ${item.version}. ${targetMark(item)}`),
    report.guidelineSearch ? `Найденные рекомендации:\n${report.guidelineSearch}` : "",
    ...report.themes.map((item) => `${item.title}\n${item.body}\n${(item.notes ?? []).map((note) => note.text).join("\n")}`),
    ...report.changes.map((item) => `${item.title}\n${item.body}`),
    ...report.conflicts.map((item) => `${item.title}\n${item.body}`),
    ...report.relationships.map((item) => `${item.title}\n${item.body}`),
    ...report.gaps,
    ...report.questions,
    ...report.cannotSay,
    ...report.limits,
    ...(report.imageReadings ?? []).map((item) => item.json),
  ].join("\n").slice(0, 12000);
}

export function acceptExplanation(candidate: string, state: OwnerState): boolean {
  const synthesis = state.report?.clinicalSynthesis?.status === "ready" ? state.report.clinicalSynthesis : null;
  const cited = [state.report?.guidelineSearch ?? "", ...catalogEntries(state.region).map((item) => targetMark(item)), ...(synthesis ? [synthesis.overview?.text ?? "", ...synthesis.hypotheses.map(item => item.text), ...synthesis.treatmentDirections.map(item => item.text), ...synthesis.practicalAdvice.map(item => item.text)] : [])].join("\n");
  return acceptWording(candidate, state, cited) && !TREATMENT.test(candidate);
}

function priorTurns(chat: ChatTurn[]): string {
  return chat
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "Вопрос" : "Ответ"}: ${turn.text}`)
    .join("\n");
}

async function classify(question: string): Promise<"ordinary" | "medication" | "urgent"> {
  try {
    return readLuna(await polzaText(LUNA.id, lunaPrompt(question), 40));
  } catch {
    return "ordinary";
  }
}

async function explain(state: OwnerState, question: string): Promise<string> {
  const route = routeQuestion(question);
  if (route === "safety_meds") return SAFETY_MEDS;
  if (route === "safety_urgent") return SAFETY_URGENT;
  const decision = decideProcessing({
    operation: "narrate",
    kind: "structured_text",
    bytes: question.length,
    hasKey: Boolean(polzaKey()),
  });
  if (!decision.allow) return "Сейчас ответ по анализам недоступен: ключ модели не задан. Разбор на экране собран правилами.";
  const kind = route === "luna" ? await classify(question) : "ordinary";
  if (kind === "medication") return SAFETY_MEDS;
  if (kind === "urgent") return SAFETY_URGENT;
  const report = buildReport(state);
  if (state.report?.inputHash === report.inputHash) {
    report.clinicalSynthesis = state.report.clinicalSynthesis;
    if (state.report.guidelineSearch) report.guidelineSearch = state.report.guidelineSearch;
    for (const theme of report.themes) {
      const saved = state.report.themes.find((item) => item.title === theme.title && item.body === theme.body);
      if (saved?.notes?.length) theme.notes = saved.notes;
    }
  }
  const finding = findingBrief(question);
  const sheet = sheetBrief(question);
  const brief = finding || sheet;
  const prompt = `${EXPLAIN_SYSTEM}

Сведения из документов:
${dossier(report)}

Предыдущий разговор:
${priorTurns(state.chat)}

${brief}

Вопрос пациента:
${question}`;
  const first = route === "opus" ? OPUS : SONNET;
  try {
    const text = await polzaText(first.id, prompt, first.id === OPUS.id ? 2200 : 900);
    if (acceptExplanation(text, state)) return text;
    if (first.id === OPUS.id && !brief) return "Ответ не показан: в нём появились диагноз, лечение или числа, которых нет в документах.";
  } catch {
    if (first.id === OPUS.id && !brief) return "Не удалось получить разъяснение. Вопрос остался здесь, наружу ушли только уже собранные сведения.";
  }
  const reviewPrompt = finding
    ? `${prompt}\n\nПрошлое пояснение не показано. Напиши заново три или четыре предложения только по этой находке. Без диагноза, без назначения, без новой разницы и без процента.`
    : sheet
      ? `${prompt}\n\nПрошлое пояснение не показано. Напиши заново, как читать весь лист вместе. Без диагноза, без назначения, без причины и без новых чисел.`
      : prompt;
  try {
    const review = await polzaText(OPUS.id, reviewPrompt, 2200);
    return acceptExplanation(review, state)
      ? review
      : "Ответ не показан: в нём появились диагноз, лечение или числа, которых нет в документах.";
  } catch {
    return "Не удалось получить разъяснение. Вопрос остался здесь, наружу ушли только уже собранные сведения.";
  }
}

export async function chatReply(state: OwnerState, question: string): Promise<ChatTurn[]> {
  const text = question.trim().slice(0, 1500);
  if (!text) return state.chat;
  const answer = await explain(state, text);
  const at = new Date().toISOString();
  state.chat.push({ role: "user", text, at }, { role: "assistant", text: answer, at });
  state.chat = state.chat.slice(-30);
  return state.chat;
}
