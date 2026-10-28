import { EYES_MODEL } from "./models";
import { sanitizeImageReading, type ImageReading } from "./image-json";
import { decideProcessing } from "./policy";

const POLZA_URL = "https://polza.ai/api/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function modelAccess(): { key: string; url: string; openRouter: boolean } | null {
  const openRouter = (process.env.OPENROUTER_API_KEY || "").trim();
  if (openRouter) return { key: openRouter, url: OPENROUTER_URL, openRouter: true };
  const polza = (process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || "").trim();
  if (polza) return { key: polza, url: POLZA_URL, openRouter: false };
  return null;
}

export function polzaKey(): string | null {
  return modelAccess()?.key ?? null;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
    .join("")
    .trim();
}

export async function polzaText(
  model: string,
  content: string | Part[],
  maxTokens: number,
  audience: "eyes" | "brain" = "brain",
  options: { system?: string; timeoutMs?: number } = {},
): Promise<string> {
  const hasImage = Array.isArray(content) && content.some((part) => part.type === "image_url");
  const decision = decideProcessing({
    operation: audience === "eyes" ? "read_image" : "narrate",
    kind: hasImage ? "image" : "structured_text",
    bytes: audience === "eyes" ? 1 : typeof content === "string" ? content.length : 0,
    hasKey: Boolean(polzaKey()),
  });
  if (hasImage && audience !== "eyes") {
    throw new Error("image_blocked_from_brain");
  }
  if (!decision.allow) throw new Error(decision.reason);
  const access = modelAccess();
  if (!access) throw new Error("polza_key_missing");
  const response = await fetch(access.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access.key}`,
      "content-type": "application/json",
      ...(access.openRouter ? { "HTTP-Referer": "https://atlaxis-tan.vercel.app", "X-Title": "ATLAXIS" } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [...(options.system ? [{ role: "system", content: options.system }] : []), { role: "user", content }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw new Error("polza_failed");
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  return messageText(body.choices?.[0]?.message?.content);
}

const EYES_PROMPT = [
  "Верни только JSON того, что видно на изображении.",
  "Ключи: studyDate, lines, measurements, medications, visualFindings.",
  "studyDate — дата исследования в формате YYYY-MM-DD или пустая строка.",
  "lines — все видимые строки подряд: показатели, даты, дозы, заключения, описания и подписи. Не сокращай страницу до нескольких показателей и не выбрасывай строки, которых нет в коротком списке анализов.",
  "measurements — объекты name, value, unit, referenceLow, referenceHigh. Извлекай все лабораторные строки, а не только липиды. Сохраняй точное название, десятичный знак, единицы и границы референса этого бланка. Не подставляй общие нормы. Для одностороннего референса заполняй только соответствующую границу. Качественные значения и знаки < или > сохраняй буквально. Не пересчитывай единицы. lines должны содержать исходные строки с результатами и датами для сверки; повторения разных дат или образцов сохраняй отдельно.",
  "medications — объекты name, dose, unit.",
  "Для ЭКГ и спирометрии сохраняй в lines название исследования, напечатанные ЧСС, PR/PQ, QRS, QT, QTc, скорость/усиление, FEV1/ОФВ1, FVC/ФЖЕЛ, отношение, PEF/ПОС, заголовки столбцов (измерено, должное, %, LLN, z-score), до/после пробы и заключение. Не вычисляй эти параметры из кривой. Табличные строки сохраняй с заголовками и исходным порядком чисел, не выбирая столбец наугад.",
  "Не добавляй диагноз, назначение и числа, которых на изображении нет.",
  "Если текста нет, lines, measurements и medications оставь пустыми. Для фотографии текстового бланка visualFindings оставь пустым.",
  "Для медицинского изображения дополнительно опиши непосредственно видимые структуры и возможные визуальные изменения в visualFindings: объекты description, region, confidence (low или moderate), frame (номер предоставленного кадра или null).",
  "Отделяй видимые признаки от текста заключения и диагностических предположений. Не ставь окончательный диагноз, не назначай лечение, не выдумывай размер, плотность/HU, кровоток или расстояние без показанной шкалы и проверенного измерения. Пустой visualFindings не означает отсутствие патологии.",
].join(" ");

const EYES_RETRY_PROMPT = [
  EYES_PROMPT,
  "Проверь изображение второй раз.",
  "Оно может быть повёрнуто, снято под углом, содержать мелкий текст, таблицу, экран телефона или медицинское изображение вместо бланка.",
  "Мысленно поверни и увеличь изображение.",
  "Если читается хотя бы одна строка, верни её в lines.",
  "Если это не текстовый бланк, но виден график, снимок, кожа, орган или другая медицинская информация, опиши только непосредственно видимое в visualFindings.",
].join(" ");

export async function readImageJson(bytes: Buffer, mime: string): Promise<ImageReading | null> {
  const frames = [{ bytes, mime, index: 0 }];
  const first = await readImageFrames(frames);
  if (hasReading(first)) return first;
  return readImageFrames(frames, EYES_RETRY_PROMPT);
}

export async function readImageFrames(
  frames: { bytes: Buffer; mime: string; index: number }[],
  prompt = EYES_PROMPT,
): Promise<ImageReading | null> {
  const decision = decideProcessing({
    operation: "read_image",
    kind: "image",
    bytes: frames.reduce((sum, frame) => sum + frame.bytes.length, 0),
    hasKey: Boolean(polzaKey()),
  });
  if (!decision.allow) return null;
  const content = await polzaText(
    EYES_MODEL,
    [
      { type: "text", text: prompt },
      ...frames.flatMap<Part>(frame => [{ type: "text", text: `Кадр ${frame.index}` }, { type: "image_url", image_url: { url: `data:${frame.mime};base64,${frame.bytes.toString("base64")}` } }]),
    ],
    8000,
    "eyes",
    { timeoutMs: 70_000 },
  );
  try {
    const reading = sanitizeImageReading(parseJsonObject(content));
    if (!reading) return proseReading(content);
    if (reading.visualFindings) {
      reading.visualFindings = reading.visualFindings.filter((item) => item.frame === null || frames.some((frame) => frame.index === item.frame));
    }
    return reading;
  } catch {
    return proseReading(content);
  }
}

function hasReading(reading: ImageReading | null): reading is ImageReading {
  return Boolean(
    reading &&
    (reading.studyDate ||
      reading.lines.length ||
      reading.measurements.length ||
      reading.medications.length ||
      (reading.visualFindings?.length ?? 0)),
  );
}

function proseReading(content: string): ImageReading | null {
  const plain = content.replace(/```(?:json)?[\s\S]*?```/gi, " ").replace(/[#*`]/g, " ").trim();
  if (plain.length < 12 || plain.length > 8000 || /<!doctype|<html|polza_failed/i.test(plain)) return null;
  const lines = plain.split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 80);
  if (!lines.length) return null;
  return sanitizeImageReading({ studyDate: "", lines, measurements: [], medications: [] });
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no json");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
