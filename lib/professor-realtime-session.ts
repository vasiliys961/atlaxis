/** Reuses the translator's WebRTC transport, but never generates a medical answer. */
export function professorRealtimeSession() {
  return {
    type: "realtime",
    model: process.env.PROFESSOR_REALTIME_MODEL || "gpt-realtime-2.1-mini",
    output_modalities: ["text"],
    instructions: "Transcribe the user's Russian speech. Do not answer questions. Answers are produced by the application's Professor backend, not this session.",
    audio: { input: {
      noise_reduction: { type: "near_field" },
      // Same transcription model as the existing translator. Can be overridden
      // independently of the medical explanation models.
      transcription: { model: process.env.PROFESSOR_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe", language: "ru" },
      turn_detection: {
        type: "server_vad", threshold: 0.5, prefix_padding_ms: 300,
        silence_duration_ms: 600, create_response: false, interrupt_response: false,
      },
    } },
  };
}

export function validSdp(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v=") && value.length <= 100_000;
}
