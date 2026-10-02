import { EYES_MODEL } from "./models";
import { sanitizeImageReading, type ImageReading } from "./image-json";

const URL = "https://polza.ai/api/v1/chat/completions";

export function polzaKey(): string | null {
  const key = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || "";
  const trimmed = key.trim();
  return trimmed || null;
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

export async function polzaText(model: string, content: string | Part[], maxTokens: number): Promise<string> {
  const key = polzaKey();
  if (!key) throw new Error("polza_key_missing");
  const response = await fetch(URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("polza_failed");
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  return messageText(body.choices?.[0]?.message?.content);
}

const EYES_PROMPT = [
  "Верни только JSON того, что видно на изображении.",
  "Ключи: studyDate, lines, measurements, medications.",
  "studyDate — дата исследования в формате YYYY-MM-DD или пустая строка.",
  "lines — видимые строки текста.",
  "measurements — объекты name, value, unit, referenceLow, referenceHigh.",
  "medications — объекты name, dose, unit.",
  "Не добавляй диагноз, назначение и числа, которых на изображении нет.",
  "Если текста нет, верни пустые массивы.",
].join(" ");

export async function readImageJson(bytes: Buffer, mime: string): Promise<ImageReading | null> {
  if (!polzaKey() || bytes.length > 8 * 1024 * 1024) return null;
  const content = await polzaText(
    EYES_MODEL,
    [
      { type: "text", text: EYES_PROMPT },
      { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } },
    ],
    1500,
  );
  const json = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return sanitizeImageReading(JSON.parse(json));
  } catch {
    return null;
  }
}
