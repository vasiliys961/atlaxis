import { SONAR_MODEL } from "./models";
import { polzaKey, polzaText } from "./polza";
import type { OwnerState, Region } from "./types";

const REFUSAL = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо|ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|схема лечения/i;

export function acceptGuidelineSearch(candidate: string): boolean {
  const text = candidate.trim();
  return Boolean(text) && !REFUSAL.test(text);
}

export const SEARCH_SCOPE = "Только самая последняя редакция.";

export const RU_NOT_FOUND = "Российскую рекомендацию поиск не нашёл.";

const RUSSIAN_SOURCE = /минздрав|рубрикатор|российск\p{L}*\s+обществ|ассоциац\p{L}*\s+россий/iu;

export function sonarFoundRussian(text: string): boolean {
  const body = text.trim();
  if (!body || !RUSSIAN_SOURCE.test(body)) return false;
  return true;
}

export function settleRussianSearch(text: string): string {
  const body = text.trim();
  if (!body || sonarFoundRussian(body) || body.includes(RU_NOT_FOUND)) return body;
  return `${RU_NOT_FOUND}\n${body}`;
}

export function settleSearch(text: string, region: Region): string {
  const body = region === "RU" ? settleRussianSearch(text) : text.trim();
  if (!body) return SEARCH_SCOPE;
  return body.startsWith(SEARCH_SCOPE) ? body : `${SEARCH_SCOPE}\n${body}`;
}

export function guidelineSearchPrompt(region: Region, measurements: string): string {
  void region;
  return `Когда сравниваешь уже записанные значения с рекомендациями, находи и называй только самые последние опубликованные данные. Это общее правило для любой справки, не только для этого комплекта. Более раннюю редакцию не цитируй и не называй текущей.

Так ищи каждую уже записанную проблему. Не ограничивайся дислипидемией и холестерином: кровь, давление, глюкоза, почки, печень и любой другой показатель ищутся так же.
По каждой проблеме, если поиск их показал, нужны два последних источника:
российский — самая новая клиническая рекомендация Минздрава России или профильного российского общества;
международный — самая новая рекомендация профильного общества, европейская, американская или международная.
Год обязателен.
Если по проблеме российской рекомендации нет, в её абзаце напиши фразу «${RU_NOT_FOUND}» и оставь только последнюю международную.
Если международного источника нет, так и напиши.
Не называй документ, которого поиск не показал.

Уже записанные проблемы и значения:
${measurements}

На каждую проблему напиши организацию, название, год и одно предложение, как источник помогает читать уже записанное значение.
Не ставь диагноз. Не назначай и не отменяй лечение, препараты и дозы.
Число из найденной рекомендации называй только вместе с организацией и годом и с пометкой, что это не личная цель.
Пиши по-русски, обычными абзацами. Начни с фразы «${SEARCH_SCOPE}».`;
}

export async function searchGuidelines(state: OwnerState): Promise<string | null> {
  if (!polzaKey() || state.facts.length === 0) return null;
  const seen = new Set<string>();
  const measurements = state.facts
    .filter((fact) => {
      if (seen.has(fact.label)) return false;
      seen.add(fact.label);
      return true;
    })
    .slice(0, 24)
    .map((fact) => `${fact.label}: ${fact.valueText} ${fact.unit}${fact.date ? `, ${fact.date}` : ""}`)
    .join("\n");
  try {
    const text = await polzaText(SONAR_MODEL, guidelineSearchPrompt(state.region, measurements), 1600);
    if (!acceptGuidelineSearch(text)) {
      return settleSearch(
        state.region === "RU"
          ? RU_NOT_FOUND
          : "Поиск не показал цитату, которую можно оставить: в ответе был диагноз или назначение.",
        state.region,
      );
    }
    return settleSearch(text, state.region);
  } catch {
    return null;
  }
}
