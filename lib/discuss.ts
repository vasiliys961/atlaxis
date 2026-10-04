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
