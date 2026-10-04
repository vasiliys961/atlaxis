import { BRAIN_MODELS } from "./models";
import { polzaKey, polzaText } from "./polza";
import { decideProcessing } from "./policy";
import { buildReport } from "./report";
import type { ChatTurn, OwnerState, ReportView } from "./types";
import { acceptWording } from "./wording";

const PROFESSOR = BRAIN_MODELS[0];

export const EXPLAIN_SYSTEM = `Ты отвечаешь с компетенцией профессора медицины из Doctor Opus: доказательная медицина, точная структура, сначала прямой ответ, затем плотное разъяснение терминов простым языком.

Единственная задача — рекомендации по уже полученным сведениям.
Рекомендация здесь — это разъяснение: что написано в документах, как значение соотносится с референсом бланка, что изменилось между датами, чего в комплекте нет и что стоит показать врачу.

Не ставь диагноз. Не назначай и не отменяй лечение, препараты, дозы и схемы.
Не придумывай числа, цели и дозы, которых нет в сведениях ниже.
Не пиши «сдайте анализ» и «вам необходимо».
Если сведений мало, скажи об этом и задай один точный вопрос.
Пиши по-русски, плотно, законченными абзацами. Без решёток, таблиц, списков со звёздами и без канцелярита.`;

const TREATMENT = /ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|отмените|схема лечения|терапевтическ(?:ая|ую) доз/i;

function dossier(report: ReportView): string {
  return [
    report.headline,
    report.intro,
    report.guidelineNote,
    report.guidelineSearch ? `Найденные рекомендации:\n${report.guidelineSearch}` : "",
    ...report.themes.map((item) => `${item.title}\n${item.body}`),
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
  return acceptWording(candidate, state, state.report?.guidelineSearch ?? "") && !TREATMENT.test(candidate);
}

function priorTurns(chat: ChatTurn[]): string {
  return chat
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "Вопрос" : "Ответ"}: ${turn.text}`)
    .join("\n");
}

async function explain(state: OwnerState, question: string): Promise<string> {
  const decision = decideProcessing({
    operation: "narrate",
    kind: "structured_text",
    bytes: question.length,
    hasKey: Boolean(polzaKey()),
  });
  if (!decision.allow) return "Сейчас ответ по анализам недоступен: ключ модели не задан. Разбор на экране собран правилами.";
  const report = buildReport(state);
  if (state.report?.inputHash === report.inputHash && state.report.guidelineSearch) {
    report.guidelineSearch = state.report.guidelineSearch;
  }
  const prompt = `${EXPLAIN_SYSTEM}

Сведения из документов:
${dossier(report)}

Предыдущий разговор:
${priorTurns(state.chat)}

Вопрос пациента:
${question}`;
  try {
    const text = await polzaText(PROFESSOR.id, prompt, 2200);
    return acceptExplanation(text, state)
      ? text
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
