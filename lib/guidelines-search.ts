import { SONAR_MODEL } from "./models";
import { polzaKey, polzaText } from "./polza";
import type { OwnerState, Region } from "./types";

const REFUSAL = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо|ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|схема лечения/i;

export function acceptGuidelineSearch(candidate: string): boolean {
  const text = candidate.trim();
  return Boolean(text) && !REFUSAL.test(text);
}

const FOCUS: Record<Region, string> = {
  RU: "Сначала уже опубликованные клинические рекомендации Минздрава России по этим показателям. Нужны организация, название, год и ссылка, если поиск их показал.",
  EU: "Рекомендации ESC, EAS, KDIGO, ADA/EASD и родственные европейские источники.",
  US: "Рекомендации AHA/ACC, ADA, KDIGO и родственные источники США.",
};

export const RU_NOT_FOUND = "Российскую рекомендацию поиск не нашёл.";

const RUSSIAN_SOURCE = /минздрав|рубрикатор|российск\p{L}*\s+обществ|ассоциац\p{L}*\s+россий/iu;

export function sonarFoundRussian(text: string): boolean {
  const body = text.trim();
  if (!body || body.includes(RU_NOT_FOUND)) return false;
  if (/не наш[её]л/iu.test(body) && /росси/iu.test(body)) return false;
  return RUSSIAN_SOURCE.test(body);
}

export function settleRussianSearch(text: string): string {
  const body = text.trim();
  if (!body || sonarFoundRussian(body) || body.includes(RU_NOT_FOUND)) return body;
  return `${RU_NOT_FOUND}\n${body}`;
}

export function guidelineSearchPrompt(region: Region, measurements: string): string {
  const missing = region === "RU"
    ? `Если опубликованной российской рекомендации по этим показателям нет, начни ответ фразой «${RU_NOT_FOUND}». После неё можно назвать источник США или Европы.`
    : "Если источник не найден, так и напиши.";
  return `Найди самые последние клинические рекомендации, которые помогают читать уже полученные анализы. Это цитата и пояснение, не диагноз и не лечение.

Куда смотреть: ${FOCUS[region]}
Не называй документ, которого поиск не показал.

Уже записанные показатели:
${measurements}

На каждый показатель, для которого поиск нашёл источник, напиши организацию, название, год и одно предложение, как этот источник помогает читать уже записанное значение.
Не ставь диагноз. Не назначай и не отменяй лечение, препараты и дозы.
Число из найденной рекомендации называй только вместе с организацией и годом и с пометкой, что это не личная цель.
${missing}
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
    if (!acceptGuidelineSearch(text)) {
      return state.region === "RU"
        ? RU_NOT_FOUND
        : "Поиск не показал цитату, которую можно оставить: в ответе был диагноз или назначение.";
    }
    return state.region === "RU" ? settleRussianSearch(text) : text;
  } catch {
    return null;
  }
}
