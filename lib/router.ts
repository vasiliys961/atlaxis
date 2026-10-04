import { LUNA, OPUS, SONNET } from "./models";

const MED_CHANGE = /отмен(?:ить|яй|ите|им)|бросить\s+(?:пить|принимать)|прекрат(?:ить|ите)|перестать\s+(?:пить|принимать)|(?:сниз|уменьш|повыс|увелич)\p{L}*\s+доз|заменить\s+препарат|можно\s+ли\s+(?:пить|принимать|отменить)|начать\s+(?:пить|принимать)/iu;
const EMERGENCY = /боль\s+в\s+груди|одышк|задыха|потер\p{L}*\s+сознан|обморок|судорог|кровотечен|суицид|хочу\s+умереть/iu;
const HARD = /доз|расхожд|спорн|срочн|неотлож/iu;
const ORDINARY = /что\s+значит|что\s+это|как\s+мен|почему\s+измени|что\s+написан|поясни|объясни/iu;

export type ChatRoute = "safety_meds" | "safety_urgent" | "sonnet" | "opus" | "luna";

export const SAFETY_MEDS = "Этот сервис не назначает, не отменяет и не меняет лечение. Не меняйте приём лекарств по этому разбору: это вопрос к врачу.";
export const SAFETY_URGENT = "Такое описание может требовать очной оценки. Если становится хуже, обратитесь за неотложной помощью. Разбор не ставит диагноз.";

export function themeIsDisputed(theme: { body: string; lead?: string }): boolean {
  return /спорн/i.test(theme.body) || /не все показатели/i.test(theme.lead ?? "");
}

export function writerFor(theme: { body: string; lead?: string }): { id: string; label: string } {
  return themeIsDisputed(theme) ? OPUS : SONNET;
}

export function routeQuestion(question: string): ChatRoute {
  const text = question.trim();
  if (MED_CHANGE.test(text)) return "safety_meds";
  if (EMERGENCY.test(text)) return "safety_urgent";
  if (HARD.test(text)) return "opus";
  if (ORDINARY.test(text)) return "sonnet";
  return "luna";
}

export function lunaPrompt(question: string): string {
  return `Классифицируй вопрос пациента одним словом: ordinary, medication или urgent. medication — просит сменить, отменить или начать лекарство. urgent — срочные симптомы. ordinary — всё остальное. Не отвечай на вопрос.\n\n${question.slice(0, 400)}`;
}

export function readLuna(text: string): "ordinary" | "medication" | "urgent" {
  const word = text.trim().toLowerCase();
  if (word.includes("medication")) return "medication";
  if (word.includes("urgent")) return "urgent";
  return "ordinary";
}

export { LUNA, OPUS, SONNET };
