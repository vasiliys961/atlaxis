import { decideProcessing } from "./policy";

export type DoctorOpusReply = {
  connected: false;
  sent: false;
  answer: string;
};

export function doctorOpusStatus(): { connected: false; transport: "local-stub" } {
  return { connected: false, transport: "local-stub" };
}

export function askDoctorOpus(question: string): DoctorOpusReply {
  const decision = decideProcessing({
    operation: "doctor_opus",
    kind: "structured_text",
    bytes: question.trim().length,
    hasKey: false,
  });
  if (!decision.allow || decision.audience !== "local") {
    return { connected: false, sent: false, answer: decision.reason };
  }
  const text = question.trim();
  if (!text) {
    return { connected: false, sent: false, answer: "Пустой вопрос не отправляется." };
  }
  return {
    connected: false,
    sent: false,
    answer: "Канал для разговора с Doctor Opus подготовлен. Удалённого MCP ещё нет, поэтому вопрос остался здесь и никуда не ушёл.",
  };
}
