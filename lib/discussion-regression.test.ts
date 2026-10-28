import test from "node:test";
import assert from "node:assert/strict";
import { chatReply, acceptExplanation } from "./explain";
import { emptyState } from "./types";

test("negated self-description does not reject an explanation; prescriptions still fail", () => {
 const state = emptyState();
 assert.equal(acceptExplanation("Я не назначаю лечение. Возможные причины можно обсудить как гипотезы.", state), true);
 assert.equal(acceptExplanation("Назначаю лечение. Принимайте препарат.", state), false);
});

test("rejected answer retries the actual follow-up with history instead of replaying the report", async () => {
 const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
 process.env.OPENROUTER_API_KEY = "test";
 let generations = 0, reviews = 0; const prompts: string[] = [];
 global.fetch = (async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const system = body.messages[0]?.role === "system" ? body.messages[0].content : "";
  let content: string;
  if (system.includes("независимый рецензент")) content = JSON.stringify({grounded: ++reviews > 1, noNewDiagnosis:true,noTreatmentPlan:true});
  else { generations++; prompts.push(body.messages.at(-1).content); content = generations === 1 ? "Возможна связь с питанием." : "Связь с жирной пищей помогает уточнить механизм боли, но сама по себе не доказывает её причину."; }
  return Response.json({choices:[{message:{content}}]});
 }) as typeof fetch;
 try {
  const state = emptyState(); state.chat.push({role:"user",text:"Боль после жирной пищи",at:"",mode:"analysis"});
  const result = await chatReply(state,"Объясни, почему важна связь с едой?", "analysis", "dialogue");
  assert.equal(generations,2); assert.equal(reviews,2);
  assert.match(prompts[1],/Боль после жирной пищи/);
  assert.match(result.at(-1)!.text,/помогает уточнить механизм/);
 } finally {global.fetch=oldFetch; if(oldKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=oldKey;}
});
