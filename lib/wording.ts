import type { OwnerState } from "./types";

const FORBIDDEN = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо/i;

export function acceptWording(candidate: string, state: OwnerState, cited = ""): boolean {
  const text = candidate.trim();
  if (!text || FORBIDDEN.test(text)) return false;
  const allowed = new Set<string>();
  for (const fact of state.facts) {
    allowed.add(fact.valueText);
    if (fact.referenceLow != null) allowed.add(String(fact.referenceLow));
    if (fact.referenceHigh != null) allowed.add(String(fact.referenceHigh));
  }
  for (const medication of state.medications) allowed.add(medication.doseText);
  for (const match of cited.matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const value = match[1] ?? "";
    allowed.add(value);
    allowed.add(value.replace(",", "."));
  }
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  for (const match of withoutDates.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ммоль\/л|г\/л|мм|Ед\/л|мг|мкг)/giu)) {
    const value = match[1]?.replace(",", ".");
    if (value && !allowed.has(value) && !allowed.has(match[1] ?? "")) return false;
  }
  return true;
}
