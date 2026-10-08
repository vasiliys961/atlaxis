export const DISCUSS_EVENT = "atlaxis-discuss-finding";

const PREFIX = "Обсудить находку: ";

export function findingQuestion(text: string): string {
  const finding = text.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (!finding) return "";
  return `${PREFIX}${finding}`;
}

export function discussFinding(text: string): void {
  const message = findingQuestion(text);
  if (!message || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(DISCUSS_EVENT, { detail: message }));
}

const SHEET = "Обсудить весь разбор: ";

export function sheetQuestion(): string {
  return `${SHEET}Как понимать весь комплект вместе: динамику, взаимосвязи, проверенные диагностические версии, направления лечения, практические советы и недостающие сведения.`;
}

export function discussSheet(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(DISCUSS_EVENT, { detail: sheetQuestion() }));
}
