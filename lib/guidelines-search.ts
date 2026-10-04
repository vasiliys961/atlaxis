import { SONAR_MODEL } from "./models";
import { polzaKey, polzaText } from "./polza";
import type { OwnerState, Region } from "./types";

const REFUSAL = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо|ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|схема лечения/i;

export function acceptGuidelineSearch(candidate: string): boolean {
  const text = candidate.trim();
  return Boolean(text) && !REFUSAL.test(text);
}

const FOCUS: Record<Region, string> = {
  RU: "Сначала клинические рекомендации Минздрава России, затем международные по тем же показателям.",
  EU: "Рекомендации ESC, EAS, KDIGO, ADA/EASD и родственные европейские источники.",
  US: "Рекомендации AHA/ACC, ADA, KDIGO и родственные источники США.",
};

export function guidelineSearchPrompt(region: Region, measurements: string): string {
  return `Найди самые последние клинические рекомендации, которые помогают читать уже полученные анализы. Это цитата и пояснение, не диагноз и не лечение.

Куда смотреть: ${FOCUS[region]}

Уже записанные показатели:
${measurements}

На каждый показатель, для которого поиск нашёл источник, напиши организацию, название, год и одно предложение, как этот источник помогает читать уже записанное значение.
Не ставь диагноз. Не назначай и не отменяй лечение, препараты и дозы.
Не добавляй числа, цели и единицы, которых нет в списке показателей.
Если источник не найден, так и напиши.
Пиши по-русски, обычными абзацами.`;
}

export async function searchGuidelines(state: OwnerState): Promise<string | null> {
  if (!polzaKey() || state.facts.length === 0) return null;
  const measurements = state.facts
    .slice(0, 40)
    .map((fact) => `${fact.label}: ${fact.valueText} ${fact.unit}${fact.date ? `, ${fact.date}` : ""}`)
    .join("\n");
  try {
    const text = await polzaText(SONAR_MODEL, guidelineSearchPrompt(state.region, measurements), 900);
    return acceptGuidelineSearch(text)
      ? text
      : "Поиск не показал цитату, которую можно оставить: в ответе был диагноз или назначение.";
  } catch {
    return null;
  }
}
