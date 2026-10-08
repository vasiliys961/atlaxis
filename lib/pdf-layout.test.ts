import assert from "node:assert/strict";
import test from "node:test";
import { layoutPageText } from "./pdf";
import { parseDocument } from "./parse";
import { buildReport } from "./report";
import { emptyState } from "./types";

test("PDF table cells are joined by baseline rather than PDF stream order",()=> {
  const cells = [
    {str:"Гемоглобин (HGB)",x:20,y:700},{str:"Тромбоциты (PLT)",x:20,y:680},
    {str:"148,10",x:250,y:700},{str:"298",x:250,y:680},
    {str:"г/л",x:310,y:700},{str:"10^9/л",x:310,y:680},
    {str:"120-160",x:400,y:700},{str:"150-400",x:400,y:680},
  ];
  const text=layoutPageText(cells);
  const parsed=parseDocument(text);
  assert.equal(parsed.facts.length,2);
  assert.equal(parsed.facts[0].value,148.1);
  assert.equal(parsed.facts[0].referenceLow,120);
  assert.equal(parsed.facts[1].value,298);
  assert.equal(parsed.facts[1].unit,"10^9/л");
});
test("unreadable table rows are processing limitations, not contradictions or doctor questions",()=> {
  const text="Эритроциты (RBC)\nГемоглобин (HGB)\nТромбоциты (PLT)";
  const parsed=parseDocument(text);
  const state=emptyState();
  state.documents.push({id:"d",fileName:"blood.pdf",status:"ready",statusLabel:"Готово",note:"",byteSize:1,contentHash:"d",pipelineVersion:"test",studyDate:null,anonymizedText:text,createdAt:""});
  state.issues=parsed.issues.map((issue,i)=>({...issue,id:String(i),documentId:"d"}));
  const report=buildReport(state);
  assert.equal(report.status,"ready");
  assert.equal(report.conflicts.length,0);
  assert.equal(report.extractionProblems?.length,1);
  assert.equal(report.extractionProblems?.[0].sources.length,3);
  assert.equal(report.questions.length,0);
  assert.doesNotMatch(report.gaps.join(" "),/нет показателей крови/);
});
