import test from "node:test";
import assert from "node:assert/strict";
import { reviewPatientReply } from "./patient-reply-review";
test("patient reply review fails closed on diagnosis, treatment plan or malformed approval", async () => {
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  let content = "{}";
  global.fetch = (async () => Response.json({choices:[{message:{content}}]})) as typeof fetch;
  try {
    for (const review of [{grounded:true,noNewDiagnosis:false,noTreatmentPlan:true},{grounded:true,noNewDiagnosis:true,noTreatmentPlan:false},{grounded:false,noNewDiagnosis:true,noTreatmentPlan:true},{}]) { content = JSON.stringify(review); assert.equal(await reviewPatientReply("question","answer","context"),false); }
    content = JSON.stringify({grounded:true,noNewDiagnosis:true,noTreatmentPlan:true});
    assert.equal(await reviewPatientReply("question","answer","context"),true);
  } finally {global.fetch=oldFetch; if(oldKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=oldKey;}
});
