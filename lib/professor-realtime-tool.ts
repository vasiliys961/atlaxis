export type ProfessorCall = { name?: string; call_id?: string; arguments?: string };
export async function professorToolResult(call: ProfessorCall, ask: (question: string) => Promise<string | undefined>) {
  if (call.name !== "ask_professor") return { error: "Неизвестная функция. Не придумывай ответ." };
  let question: string;
  try { const body = JSON.parse(call.arguments || "{}"); question = body.question; if (typeof question !== "string" || !question.trim() || question.length > 1500) throw new Error(); }
  catch { return { error: "Вопрос функции некорректен. Попроси пользователя повторить вопрос." }; }
  try { const answer = await ask(question.trim()); return answer ? { answer, source: "atlaxis_chat" } : { error: "Профессор не вернул ответ. Не придумывай медицинский ответ." }; }
  catch { return { error: "Профессор сейчас недоступен. Не придумывай медицинский ответ." }; }
}
