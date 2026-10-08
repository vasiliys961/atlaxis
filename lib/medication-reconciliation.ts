import type { MedicationMention, OwnerState } from "./types";

type MedicationGroup = { name: string; mentions: MedicationMention[] };
export type MedicationReconciliation = {
  changes: MedicationGroup[];
  conflicts: MedicationGroup[];
  missing: string[];
};

const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const signature = (item: MedicationMention) => JSON.stringify([
  item.dose, normalized(item.unit), normalized(item.frequency ?? ""),
]);

const written = (item: MedicationMention) => `${item.doseText} ${item.unit}${item.frequency ? `, ${item.frequency}` : ""}${item.date ? ` (${item.date})` : " (дата неизвестна)"}`;
export function medicationChangeText({ name, mentions }: MedicationGroup): string {
  return `Для «${name}» в разные даты различаются записи дозы или кратности приёма: ${mentions.map(written).join(", затем ")}. Это смена записи во времени; фактический приём и причина изменения по документам не устанавливаются. Если кратность отсутствует, её нельзя считать неизменной.`;
}
export function medicationConflictText({ name, mentions }: MedicationGroup): string {
  return `Для «${name}» записи дозы, единиц или кратности относятся к одной дате или к одному документу без известной даты: ${mentions.map(written).join(" и ")}. Разбор оставляет все записи как есть; они требуют сверки и могут относиться к разным приёмам в течение дня. Отсутствующая кратность не означает отсутствие приёма.`;
}

// Compare written regimens, never infer current use, daily dose or drug equivalence.
export function reconcileMedications(state: OwnerState): MedicationReconciliation {
  const ready = new Set(state.documents.filter(d => d.status === "ready").map(d => d.id));
  const byDrug = new Map<string, MedicationMention[]>();
  for (const item of state.medications) {
    if (!ready.has(item.documentId)) continue;
    const name = normalized(item.name);
    byDrug.set(name, [...(byDrug.get(name) ?? []), item]);
  }
  const changes: MedicationGroup[] = [];
  const conflicts: MedicationGroup[] = [];
  const missing: string[] = [];
  for (const [name, mentions] of byDrug) {
    if (mentions.some(item => !item.date)) missing.push(`Для «${name}» есть запись без даты: порядок изменений не устанавливается.`);
    if (mentions.some(item => !item.frequency?.trim())) missing.push(`Для «${name}» кратность приёма указана не во всех записях; суточная доза не определяется.`);
    const units = new Set(mentions.map(item => normalized(item.unit)));
    if (units.size > 1 || units.has("")) missing.push(`Для «${name}» единицы дозы различаются или отсутствуют; дозы непосредственно не сопоставляются.`);
    const groups = new Map<string, MedicationMention[]>();
    for (const item of mentions) {
      // Undated records from different documents are not a shared study date.
      const key = item.date ? `date:${item.date}` : `undated:${item.documentId}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const disputed = [...groups.values()].filter(group => new Set(group.map(signature)).size > 1).flat();
    if (disputed.length) conflicts.push({ name, mentions: disputed });
    // Unknown dates or units prevent a reliable longitudinal ordering/comparison.
    if (disputed.length || mentions.some(item => !item.date || !item.unit.trim() || !Number.isFinite(item.dose) || item.dose <= 0)) continue;
    if (new Set(mentions.map(item => normalized(item.unit))).size !== 1) continue;
    if (new Set(mentions.map(item => item.date)).size < 2 || new Set(mentions.map(signature)).size < 2) continue;
    const dated = [...mentions].sort((a, b) => a.date!.localeCompare(b.date!));
    // Collapse duplicate copies while retaining each distinct dated regimen.
    const unique = dated.filter((item, index) => !dated.slice(0, index).some(other => other.date === item.date && signature(other) === signature(item)));
    changes.push({ name, mentions: unique });
  }
  return { changes, conflicts, missing };
}
