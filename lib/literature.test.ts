import test from "node:test";
import assert from "node:assert/strict";
import { searchLiterature, validLiteratureCitations } from "./literature";
import { chatReply } from "./explain";
import { emptyState } from "./types";

test("general chat uses extracted search terms and abstracts without document history", async () => {
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  const requests: string[] = [];
  global.fetch = (async (url: any, options: any) => {
    requests.push(String(url) + (options?.body ?? ""));
    if (String(url).includes("europepmc")) return Response.json({ resultList: { result: [{ pmid: "123", title: "Ferritin study", pubYear: "2025", abstractText: "<p>Ferritin reflects iron stores and inflammation.</p>" }] } });
    const body = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: body.max_tokens === 350 ? JSON.stringify({grounded:true,noNewDiagnosis:true,noTreatmentPlan:true}) : body.max_tokens === 120 ? "ferritin inflammation" : "Ферритин отражает запасы железа и воспаление. PMID: 123." } }] });
  }) as typeof fetch;
  try {
    const state = emptyState();
    state.chat = [{ role: "user", text: "PRIVATE_DOCUMENT_HISTORY", at: "now" }];
    const turns = await chatReply(state, "Что показывает ферритин?", "general");
    assert.equal(turns.at(-1)?.sources?.[0].pmid, "123");
    assert.equal(turns.at(-1)?.mode, "general");
    assert.ok(requests.every(r => !r.includes("PRIVATE_DOCUMENT_HISTORY")));
    assert.ok(requests.some(r => r.includes("Ferritin reflects iron stores")));
    assert.ok(!requests.find(r => r.includes("europepmc"))?.includes("ферритин"));
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});

test("citation gate refuses fabricated PMID", () => {
  assert.equal(validLiteratureCitations("PMID: 999", []), false);
  assert.equal(validLiteratureCitations("https://pubmed.ncbi.nlm.nih.gov/999/", []), false);
});

test("search provider failure is explicit unavailable", async () => {
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  global.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try { assert.equal((await searchLiterature("ferritin")).status, "unavailable"); }
  finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});
