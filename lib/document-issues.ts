import type { DocumentIssue } from "./types";

export function extractionIssue(issue: Pick<DocumentIssue, "description">): boolean {
  return /но (?:числа рядом|пары чисел) нет|Дата в строке не складывается/.test(issue.description);
}
