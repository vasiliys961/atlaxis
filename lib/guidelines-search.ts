import { retrieveGuidelineSources } from "./guideline-sources";
import { SONAR_MODEL } from "./models";
import { polzaKey, polzaText } from "./polza";
import type { OwnerState, Region } from "./types";
import { buildClinicalContext } from "./clinical-context";

const REFUSAL = /назначьте|следует назначить|отмените|диагноз\s*:|сдайте|вам необходимо|ставлю диагноз|ваш диагноз|это диагноз|назначаю|принимайте|схема лечения/i;

export function acceptGuidelineSearch(candidate: string): boolean {
  const text = candidate.trim();
  return Boolean(text) && !REFUSAL.test(text);
}

export const SEARCH_SCOPE = "Поиск региональных источников по темам документов; без оценки результатов пациента. Актуальность редакции требует проверки.";

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
  const primary = { RU: "Российская Федерация: клинические рекомендации Минздрава РФ и профильных российских обществ", US: "США: американские профильные общества и государственные источники", EU: "Европа: европейские профильные общества" }[region];
  return `Выбранная основная система рекомендаций: ${primary}. Её источники и популяционные критерии имеют приоритет.
РФ, США и Европа рассматриваются отдельно: для каждой проблемы сначала выбранный регион, затем доступные сопоставления других регионов. Не смешивай пороги и лечебные цели между регионами.
Если источник выбранного региона не найден, явно сообщи об этом; международный источник не выдавай за национальный.

Ищи действующие редакции по первичным источникам. Не называй редакцию последней или актуальной, если это не подтверждено опубликованным документом и проверкой последующих обновлений. Отсутствие свежего результата поиска не доказывает отсутствие обновления.

Так ищи каждую уже записанную проблему. Не ограничивайся дислипидемией и холестерином: кровь, давление, глюкоза, почки, печень и любой другой показатель ищутся так же.
По каждой проблеме, если поиск их показал, нужны последние источники трёх регионов:
РФ — клиническая рекомендация Минздрава России или профильного российского общества;
США — рекомендация американского профильного общества или государственного органа;
Европа — рекомендация европейского профильного общества.
Выбранный регион перечисляй первым; источники остальных регионов обозначай как сопоставление. Международные рекомендации вне этих регионов обозначай отдельно.
Год обязателен.
Если по проблеме российской рекомендации нет, в её абзаце напиши фразу «${RU_NOT_FOUND}» и оставь только последнюю международную.
Если международного источника нет, так и напиши.
Не называй документ, которого поиск не показал.

Темы для поиска (не данные пациента):
${measurements}

На каждую тему напиши регион, организацию, название, год и явную HTTPS-ссылку на первичный источник. Не анализируй результаты пациента, не придумывай значения анализов, не сравнивай их с порогами. Только библиографические сведения и предмет документа.
Не ставь новый или предположительный диагноз. Не создавай персональные лечебные направления, цели или план обследования. Не назначай и не отменяй лечение, препараты и дозы. Объясняй назначение показателей, условия интерпретации и вопросы врачу. Статьи не выдавай за клинические рекомендации.
Не приводи числовые лечебные цели, дозы и пороги: этот этап только находит источники.
Пиши по-русски, обычными абзацами. Начни с фразы «${SEARCH_SCOPE}».`;
}

export async function searchGuidelines(state: OwnerState): Promise<string | null> {
  if (!polzaKey()) return null;
  const context = buildClinicalContext(state);
  if (!context.complete) return null;
  const seen = new Set<string>();
  const measurements = state.facts
    .filter((fact) => {
      if (seen.has(fact.label)) return false;
      seen.add(fact.label);
      return true;
    })
    .map((fact) => fact.label)
    .join("\n");
  try {
    const topics = measurements || "Общее объяснение лабораторного бланка; конкретные результаты пока не извлечены. Не предполагай заболевания или отсутствующие показатели.";
    const text = await polzaText(SONAR_MODEL, guidelineSearchPrompt(state.region, topics), 3000, "brain", { timeoutMs: 15_000, system: "Ищи первичные клинические рекомендации по указанным темам. Только библиография, без персонального разбора. Не выдумывай найденные источники." });
    if (!acceptGuidelineSearch(text)) {
      return settleSearch(
        state.region === "RU"
          ? RU_NOT_FOUND
          : "Поиск не показал цитату, которую можно оставить: в ответе был диагноз или назначение.",
        state.region,
      );
    }
    const sources = await retrieveGuidelineSources(text);
    return settleSearch(`${text}\n\nПроверка доступа к первичным страницам (не подтверждает актуальность, содержание всего документа или применимость):\n${JSON.stringify(sources)}\nПроверено не более трёх ссылок. Остальные ссылки и сведения поискового ответа не проверены.`, state.region);
  } catch {
    return null;
  }
}
