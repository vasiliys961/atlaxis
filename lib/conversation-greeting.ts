/** Match standalone social turns only; a medical question or symptom must reach the medical pipeline. */
export function conversationGreeting(question: string): string | undefined {
  const text = question.toLocaleLowerCase("ru").replace(/[.,!?…:;«»"—–-]/g, " ").replace(/\s+/g," ").trim();
  if (/^(?:привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер|алло)(?: (?:как дела|как ваши дела|ты меня слышишь|вы меня слышите))?$/.test(text)) return "Здравствуйте! Я на связи. Что хотите обсудить?";
  if (/^(?:ты меня слышишь|вы меня слышите|меня слышно)$/.test(text)) return "Да, ваш вопрос получен. Я готов ответить.";
  if (/^(?:как дела|как ваши дела)$/.test(text)) return "Я готов к разговору. Какой у вас вопрос?";
  return undefined;
}
