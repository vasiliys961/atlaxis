import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeImageReading } from "./image-json";
import { sourceDocumentText } from "./source-document";
import { buildClinicalContext } from "./clinical-context";
import { measurementHistory } from "./measurement-history";
import { parseDocument } from "./parse";
import { emptyState, type MedicalDocument } from "./types";

function document(text: string, name = "source.txt"): MedicalDocument {
  return { id:"d",fileName:name,byteSize:1,contentHash:"d",pipelineVersion:"test",status:"ready",statusLabel:"Готово",note:"",studyDate:null,anonymizedText:text,createdAt:"" };
}
test("large OCR retains the 41st and last rows and full clinical sentences", () => {
  const lines = Array.from({length:120}, (_,i) => `Неизвестный показатель ${i}: ${"описание ".repeat(40)}`);
  const measurements = Array.from({length:100}, (_,i) => ({name:`Маркер ${i}`,value:String(i),unit:"мг/л"}));
  const reading = sanitizeImageReading({lines,measurements});
  assert.equal(reading?.lines.length,120);
  assert.equal(reading?.lines[119],lines[119].trim());
  assert.equal(reading?.measurements.length,100);
});
test("oversized OCR is rejected instead of returning a partial reading", () => {
  assert.equal(sanitizeImageReading({lines:Array(501).fill("Глюкоза 5 ммоль/л")}),null);
  assert.equal(sanitizeImageReading({lines:["А".repeat(4001)]}),null);
  assert.equal(sanitizeImageReading({measurements:[{name:"А".repeat(161),value:"5"}]}),null);
});
test("source explorer lines match every image evidence ID including blanks in text documents", () => {
  const state = emptyState();
  state.documents.push(document(JSON.stringify({studyDate:"2025-01-01",lines:["Глюкоза 5 ммоль/л"],measurements:[{name:"Кальпротектин",value:"180",unit:"мкг/г"}]}),"source.png"));
  const context = buildClinicalContext(state);
  const lines = sourceDocumentText(state.documents[0]).split("\n");
  for (const source of context.sources.values()) assert.equal(lines[source.line-1],source.excerpt);
  assert.equal(sourceDocumentText(document("Первая\n\nТретья")).split("\n")[2],"Третья");
});
test("history keeps all results and warns about units, references, unknown dates and same-day differences", () => {
  const state = emptyState();
  const text = "Глюкоза 7 ммоль/л\nДата исследования: 2024-01-01\nГлюкоза 5 ммоль/л 3-6\nДата исследования: 2025-01-01\nГлюкоза 100 мг/дл 70-110\nГлюкоза 120 мг/дл 70-110";
  state.documents.push(document(text));
  state.facts = parseDocument(text).facts.map((f,i)=>({...f,id:String(i),documentId:"d"}));
  const group = measurementHistory(state)[0];
  assert.equal(group.entries.length,4);
  assert.equal(group.entries.at(-1)?.date,null);
  assert.match(group.limitations.join(" "),/Единицы.*Референсы.*без даты.*одну дату/s);
  state.documents[0].status = "failed";
  assert.equal(measurementHistory(state).length,0);
});
