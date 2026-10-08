import { readFile } from "node:fs/promises";
import { parseDocument } from "../lib/parse";
import { buildClinicalContext } from "../lib/clinical-context";
import { emptyState } from "../lib/types";

type Expected = { concept: string; value: number; unit: string; date: string | null; line: number; referenceLow: number | null; referenceHigh: number | null };
async function main() {
const corpus = JSON.parse(await readFile("fixtures/quality/baseline.json", "utf8")) as { provenance: string; cases: {id:string;text:string;expected:Expected[];preserved?:string[]}[] };
const keys: (keyof Expected)[] = ["concept", "value", "unit", "date", "line", "referenceLow", "referenceHigh"];
let expectedCount = 0, actualCount = 0, matched = 0, preservedCount = 0, preservedMatched = 0;
const results = corpus.cases.map(item => {
  const parsed = parseDocument(item.text);
  const remaining = [...parsed.facts];
  const missing = item.expected.filter(expected => {
    const index = remaining.findIndex(actual => keys.every(key => actual[key] === expected[key]));
    if (index < 0) return true;
    remaining.splice(index, 1); matched++; return false;
  });
  expectedCount += item.expected.length; actualCount += parsed.facts.length;
  const state = emptyState();
  state.documents.push({ id:item.id,fileName:`${item.id}.txt`,byteSize:1,contentHash:item.id,pipelineVersion:"evaluation",status:"ready",statusLabel:"Готово",note:"",studyDate:parsed.studyDate,anonymizedText:item.text,createdAt:"" });
  const context = buildClinicalContext(state);
  const lost = (item.preserved ?? []).filter(text => {
    preservedCount++;
    if ([...context.sources.values()].some(source => source.excerpt === text)) { preservedMatched++; return false; }
    return true;
  });
  return { id:item.id,pass:!missing.length && !remaining.length && !lost.length,missing,unexpected:remaining.map(f => Object.fromEntries(keys.map(key => [key,f[key]]))),lost };
});
console.log(JSON.stringify({ provenance:corpus.provenance, paidApiCalls:0, cases:results.length, passed:results.filter(r=>r.pass).length, exactFactPrecision:actualCount ? matched/actualCount : null, exactFactRecall:expectedCount ? matched/expectedCount : null, preservedUnknownOrCensored:preservedCount ? preservedMatched/preservedCount : null, results },null,2));
if (results.some(result => !result.pass)) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
