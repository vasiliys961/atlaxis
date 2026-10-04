export type ProcessingOperation = "read_image" | "narrate" | "doctor_opus";
export type ProcessingKind = "image" | "dicom" | "structured_text";
export type ProcessingAudience = "eyes" | "brain" | "local" | "none";

export type ProcessingDecision = {
  allow: boolean;
  audience: ProcessingAudience;
  reason: string;
};

const IMAGE_LIMIT = 8 * 1024 * 1024;

export function decideProcessing(input: {
  operation: ProcessingOperation;
  kind: ProcessingKind;
  bytes: number;
  hasKey: boolean;
}): ProcessingDecision {
  if (input.kind === "dicom" || (input.operation === "read_image" && input.kind !== "image")) {
    return {
      allow: false,
      audience: "none",
      reason: "DICOM во внешнюю модель не отправляется: текст на самом изображении не проверяется.",
    };
  }

  if (input.operation === "doctor_opus") {
    return {
      allow: true,
      audience: "local",
      reason: "Вопрос остаётся локально. У Doctor Opus ещё нет своего MCP, наружу ничего не уходит.",
    };
  }

  if (input.operation === "narrate") {
    if (input.kind !== "structured_text") {
      return { allow: false, audience: "none", reason: "В пересказ нельзя отправлять снимок, только уже собранный текст." };
    }
    if (!input.hasKey) return { allow: false, audience: "none", reason: "Ключ Пользы AI не задан, пересказ не вызывается." };
    return { allow: true, audience: "brain", reason: "В мозг уходит готовый текст разбора, без файла снимка." };
  }

  if (!input.hasKey) return { allow: false, audience: "none", reason: "Ключ Пользы AI не задан, снимок не отправляется на чтение." };
  if (input.bytes <= 0 || input.bytes > IMAGE_LIMIT) {
    return { allow: false, audience: "none", reason: "Снимок больше 8 МБ и в чтение не отправляется." };
  }
  return { allow: true, audience: "eyes", reason: "Снимок читают только глаза. В мозг уходит уже готовый JSON, не файл." };
}
