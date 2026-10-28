"use client";
import { useEffect, useRef, useState } from "react";
import { ProfessorRealtime as Connection, type ProfessorRealtimePhase } from "@/lib/professor-realtime";
type Line = { id: string; role: "user" | "assistant"; text: string };
export function ProfessorRealtime({mode,onQuestion,onBeforeStart,onActive}:{mode:"general"|"analysis";onQuestion:(question:string)=>Promise<string|undefined>;onBeforeStart:()=>void;onActive:(active:boolean)=>void}) {
  const connection=useRef<Connection>();if(!connection.current)connection.current=new Connection();
  const [phase,setPhase]=useState<ProfessorRealtimePhase>("off"),[blocked,setBlocked]=useState(false),[error,setError]=useState(""),[lines,setLines]=useState<Line[]>([]),[draft,setDraft]=useState(""),[latency,setLatency]=useState<number>();
  const askRef=useRef(onQuestion);askRef.current=onQuestion;
  useEffect(()=>()=>connection.current?.stop(),[]);
  useEffect(()=>{onActive(phase!=="off");},[phase,onActive]);
  const active=phase!=="off",ready=phase==="listening";
  async function start(microphone:boolean){onBeforeStart();setError("");setLines([]);setLatency(undefined);await connection.current!.start({mode,microphone,ask:question=>askRef.current(question),onPhase:setPhase,onBlocked:setBlocked,onLatency:setLatency,onError:setError,onLine:(id,role,text)=>setLines(previous=>{const rest=previous.filter(line=>line.id!==id || line.role!==role);return [...rest,{id,role,text}].slice(-12);})});}
  function send(){if(!draft.trim()||!ready)return;const text=draft.trim();setDraft("");setLines(previous=>[...previous,{id:crypto.randomUUID(),role:"user",text}]);try{connection.current!.sendText(text);}catch(cause){setError(cause instanceof Error?cause.message:"Не удалось отправить вопрос");}}
  const labels:Record<ProfessorRealtimePhase,string>={off:"",connecting:"Подключаем Realtime…",listening:"Слушаю. Можно задать следующий вопрос.",hearing:"Слышу вашу речь…",thinking:"Готовлю короткий ответ…",consulting:"Профессор проверяет ответ по выбранному режиму…",playing:"Отвечаю голосом…"};
  return <section className="professor-realtime" aria-label="Быстрый голосовой разговор">
    <p className="voice-step">Быстрый разговор · Realtime</p>
    <div className="avatar-toolbar">{!active?<><button onClick={()=>void start(true)}>Начать голосовой разговор</button><button className="secondary" onClick={()=>void start(false)}>Вопрос текстом → ответ голосом</button></>:<button className="secondary" onClick={()=>connection.current?.stop()}>Завершить Realtime</button>}</div>
    {active&&<p className="avatar-status" role="status">{labels[phase]}</p>}
    {blocked&&<button onClick={()=>void connection.current?.enableSound()}>Включить звук Realtime</button>}
    {active&&<div className="realtime-text-input"><textarea aria-label="Реплика в реальном времени" value={draft} maxLength={1500} rows={2} placeholder="Реплика в этот разговор" onChange={event=>setDraft(event.target.value)}/><button disabled={!ready||!draft.trim()} onClick={send}>Сказать в сессии</button></div>}
    {latency!==undefined&&<p className="avatar-note">Начало звукового ответа после определения конца реплики: {(latency/1000).toFixed(1)} с.</p>}
    {lines.length>0&&<details className="avatar-transcript" open><summary>Реплики Realtime</summary>{lines.map(line=><p key={line.id+line.role}><strong>{line.role==="user"?"Вы":"Профессор"}:</strong> {line.text}</p>)}</details>}
    {error&&<p className="avatar-status error" role="alert">{error}</p>}
    <p className="avatar-note">{mode==="analysis"?"По документам ответ готовит профессор Атлаксиса, затем эта сессия произносит его.":"Общие темы можно обсудить сразу. Медицинский вопрос уходит профессору без личных документов, затем сессия произносит ответ."} Сессия до 15 минут. Это дороже пошагового голоса: минуты аудио OpenAI и каждый ответ профессора.</p>
  </section>;
}
