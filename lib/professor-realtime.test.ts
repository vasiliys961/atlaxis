import test from "node:test";
import assert from "node:assert/strict";
import { professorRealtimeSession } from "./professor-realtime-session";
import { professorToolResult } from "./professor-realtime-tool";
test("analysis mode requires the medical tool; general mode can reply directly",()=>{
 const clinical=professorRealtimeSession("analysis"),general=professorRealtimeSession("general","user: Почему небо голубое?");
 assert.equal(clinical.tool_choice,"required");assert.equal(general.tool_choice,"auto");
 assert.equal(clinical.audio.input.turn_detection.silence_duration_ms,300);
 assert.equal(clinical.audio.input.turn_detection.interrupt_response,false);
 assert.match(general.instructions,/Почему небо голубое/);assert.match(clinical.instructions,/не выдумывай данные/);
 assert.equal(clinical.max_output_tokens,2048);assert.match(clinical.instructions,/произноси целиком/);
});
test("only a valid professor tool question can call the app; exact answer is preserved",async()=>{
 let calls=0;const ask=async(q:string)=>{calls++;assert.equal(q,"Какой показатель изменился?");return "Показатель 4,5 ммоль/л; это не установленный диагноз.";};
 for(const call of [{name:"read_file",arguments:'{}'},{name:"ask_professor",arguments:'{}'},{name:"ask_professor",arguments:'{broken'},{name:"ask_professor",arguments:JSON.stringify({question:"x".repeat(1501)})}])assert.ok("error" in await professorToolResult(call,ask));
 assert.equal(calls,0);
 const output=await professorToolResult({name:"ask_professor",arguments:JSON.stringify({question:"Какой показатель изменился?"})},ask);
 assert.equal(calls,1);assert.equal(output.answer,"Показатель 4,5 ммоль/л; это не установленный диагноз.");
});
test("unavailable medical backend returns an error instead of an invented answer",async()=>{
 const result=await professorToolResult({name:"ask_professor",arguments:'{"question":"Мои анализы?"}'},async()=>{throw new Error("offline");});
 assert.ok("error" in result);assert.equal("answer" in result,false);
});

 test("professor speaks as himself and never narrates internal delegation", () => {
 const session=professorRealtimeSession("analysis");
 assert.match(session.instructions,/Говори от первого лица/);
 assert.match(session.instructions,/Перед вызовом функции не произноси ни одной фразы/);
 });
