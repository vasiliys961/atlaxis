import test from "node:test";
import assert from "node:assert/strict";
import { chatReply, VOICE_DIALOGUE_STYLE } from "./explain";
import { emptyState } from "./types";
test("voice format preserves context and review; written requests keep their original format", async () => {
  const originalFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  const generation: any[] = []; let reviews = 0;
  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const system = body.messages[0]?.role === "system" ? body.messages[0].content : "";
    const content = system.startsWith("Extract only") ? "NONE" : system.includes("независимый рецензент") ? (++reviews, JSON.stringify({grounded:true,noNewDiagnosis:true,noTreatmentPlan:true})) : (generation.push(body), "Синий свет сильнее рассеивается воздухом, поэтому небо голубое.");
    return Response.json({ choices: [{message: {content}}] });
  }) as typeof fetch;
  try {
    const state = emptyState();
    await chatReply(state, "Почему небо голубое?", "general", "dialogue");
    await chatReply(state, "А на закате?", "general", "dialogue");
    assert.match(generation[0].messages[0].content, /голосовой диалог/);
    assert.ok(generation[0].messages[0].content.includes(VOICE_DIALOGUE_STYLE));
    const context = JSON.parse(generation[1].messages[1].content);
    assert.match(context.history, /Почему небо голубое/);
    assert.equal(reviews, 2);
    await chatReply(state, "Расскажи подробно", "general");
    assert.doesNotMatch(generation[2].messages[0].content, /Это голосовой диалог/);
    assert.equal(generation[2].max_tokens, 1800);
    assert.equal(reviews, 3);
  } finally { global.fetch = originalFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});
