export const EYES_MODEL = "google/gemini-3.8-flash";
export const SONAR_MODEL = "perplexity/sonar";
export const BRAIN_MODELS = [
  { id: "anthropic/claude-opus-5.5", label: "Opus 5.5" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1" },
] as const;

export const OPUS = BRAIN_MODELS[0];
export const SONNET = { id: "anthropic/claude-sonnet-5.5", label: "Sonnet 5.5" } as const;
export const LUNA = { id: "openai/gpt-6-luna", label: "Luna" } as const;
