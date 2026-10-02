const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE = /(?:\+7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}/;
const PASSPORT = /\b\d{4}\s?\d{6}\b/;
const SNILS = /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/;
const POLICY = /\b(?:полис|омс|снилс|паспорт)\b/i;
const BIRTH = /дат[аы]\s+рожден/i;
const ADDRESS = /(г\.|город|ул\.|улица|проспект|кв\.|квартира)\s+\S+/i;
const FIO = /(?<![\p{L}])[А-ЯЁ][а-яё]{1,25}\s+[А-ЯЁ][а-яё]{1,25}(?:\s+[А-ЯЁ][а-яё]{1,25})?(?![\p{L}])/gu;
const INITIALS = /(?<![\p{L}])[А-ЯЁ][а-яё]{1,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./gu;
const LATIN_NAME = /(?<![\p{L}])[A-Z][a-z]{2,20}\s+[A-Z][a-z]{2,20}(?![\p{L}])/gu;

const KEEP_WORDS = new Set([
  "Артериальное",
  "Давление",
  "Общий",
  "Анализ",
  "Крови",
  "Дата",
  "Исследования",
  "Заключение",
  "Гемоглобин",
]);

export type Anonymized = {
  text: string;
  redactionCount: number;
  leaked: boolean;
};

function sensitiveLine(line: string): boolean {
  return BIRTH.test(line) || POLICY.test(line) || ADDRESS.test(line) || PASSPORT.test(line) || SNILS.test(line);
}

export function anonymizeText(input: string): Anonymized {
  const lines = input.split(/\r?\n/).map((line) => {
    if (sensitiveLine(line)) return "[данные удалены]";
    let next = line;
    next = next.replace(EMAIL, "[email]");
    next = next.replace(PHONE, "[телефон]");
    next = next.replace(PASSPORT, "[документ]");
    next = next.replace(SNILS, "[документ]");
    next = next.replace(INITIALS, "[имя]");
    next = next.replace(FIO, (match) => {
      const words = match.split(/\s+/);
      if (words.some((word) => KEEP_WORDS.has(word))) return match;
      return "[имя]";
    });
    next = next.replace(LATIN_NAME, "[имя]");
    return next;
  });

  const text = lines.join("\n");
  const leaked = EMAIL.test(text) || PHONE.test(text) || PASSPORT.test(text) || SNILS.test(text) || BIRTH.test(text);
  const redactionCount = (text.match(/\[(?:email|телефон|документ|имя|данные удалены)\]/g) ?? []).length;
  return { text, redactionCount, leaked };
}
