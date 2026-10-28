"use client";
import { useEffect, useRef, useState } from "react";
export function RealtimeDemo() {
  const [enabled,setEnabled]=useState(false),[phase,setPhase]=useState("off"),[error,setError]=useState(""),[draft,setDraft]=useState("Расскажи коротко об Атлаксисе."),[lines,setLines]=useState<string[]>([]);
  const pc=useRef<RTCPeerConnection|null>(null),channel=useRef<RTCDataChannel|null>(null),microphone=useRef<MediaStream|null>(null),audio=useRef<HTMLAudioElement|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),generation=useRef(0);
  const check=()=>fetch("/api/realtime").then(r=>r.json()).then(b=>setEnabled(b.enabled===true)).catch(()=>setEnabled(false));
  function stop(){generation.current++;if(timer.current)clearTimeout(timer.current);timer.current=null;channel.current?.close();channel.current=null;pc.current?.close();pc.current=null;microphone.current?.getTracks().forEach(t=>t.stop());microphone.current=null;if(audio.current){audio.current.pause();audio.current.srcObject=null;}setPhase("off");}
  useEffect(()=>{setPhase("off");void check();return()=>{generation.current++;if(timer.current)clearTimeout(timer.current);channel.current?.close();pc.current?.close();microphone.current?.getTracks().forEach(t=>t.stop());if(audio.current){audio.current.pause();audio.current.srcObject=null;}};},[]);
  async function start(withMic:boolean){
    stop();const current=generation.current;setError("");setPhase("connecting");setLines([]);
    try{
      const peer=new RTCPeerConnection();pc.current=peer;const player=new Audio();player.autoplay=true;audio.current=player;
      peer.ontrack=e=>{player.srcObject=e.streams[0];void player.play().catch(()=>setError("Звук заблокирован браузером. Нажмите «Воспроизвести звук»."));};
      if(withMic){const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(current!==generation.current){stream.getTracks().forEach(t=>t.stop());return;}microphone.current=stream;stream.getTracks().forEach(t=>peer.addTrack(t,stream));}else peer.addTransceiver("audio",{direction:"recvonly"});
      const dc=peer.createDataChannel("oai-events");channel.current=dc;
      dc.onopen=()=>{if(current===generation.current)setPhase(withMic?"listening":"connected");};
      dc.onmessage=e=>{if(current!==generation.current)return;try{const event=JSON.parse(e.data);if(event.type==="conversation.item.input_audio_transcription.completed")setLines(old=>[...old,`Вы: ${event.transcript}`]);if(event.type==="response.output_audio_transcript.done")setLines(old=>[...old,`Помощник: ${event.transcript}`]);if(event.type==="error")setError("OpenAI сообщил об ошибке голосовой сессии.");}catch{}};
      peer.onconnectionstatechange=()=>{if(current===generation.current&&["failed","disconnected","closed"].includes(peer.connectionState)){stop();setError("Голосовое соединение закрыто.");}};
      const offer=await peer.createOffer();await peer.setLocalDescription(offer);
      const response=await fetch("/api/realtime",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sdp:offer.sdp})});const result=await response.json();if(!response.ok)throw new Error(result.error);
      if(current!==generation.current)return;await peer.setRemoteDescription({type:"answer",sdp:result.answerSdp});timer.current=setTimeout(()=>{stop();setError("Трёхминутная проба завершена. Можно подключиться снова.");},180000);
    }catch(reason){if(current===generation.current){stop();setError(reason instanceof Error?reason.message:"Не удалось подключиться.");}}
  }
  function send(){if(!draft.trim()||channel.current?.readyState!=="open")return;const text=draft.trim();channel.current.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text}]}}));channel.current.send(JSON.stringify({type:"response.create"}));setLines(old=>[...old,`Вы: ${text}`]);setDraft("");}
  return <section className="realtime-demo"><details><summary>OpenAI Realtime · голосовой тест</summary>
    <p className="quiet">Отдельный разговор о приложении. Документы и чат профессора автоматически не передаются. При голосовом режиме микрофон передаёт речь в OpenAI; API оплачивается отдельно. Видео Кристи этим режимом пока не управляется.</p>
    {phase==="off"?<div className="local-avatar-actions"><button type="button" disabled={!enabled} onClick={()=>void start(false)}>Текст → голос OpenAI</button><button className="secondary" type="button" disabled={!enabled} onClick={()=>void start(true)}>Разговор с микрофоном</button><button className="secondary" type="button" onClick={()=>void check()}>Обновить статус</button></div>:<button className="secondary" type="button" onClick={stop}>Завершить тест</button>}
    {!enabled?<p className="quiet" role="status">Нужен OPENAI_API_KEY в .env.local тестовой копии. Ключ в браузер не передаётся.</p>:null}
    {phase!=="off"?<><p role="status" className="quiet">{phase==="connecting"?"Подключаемся…":phase==="listening"?"Микрофон включён. Слушаю вас.":"Соединение открыто. Введите вопрос."}</p><textarea aria-label="Вопрос OpenAI Realtime" value={draft} onChange={e=>setDraft(e.target.value)} rows={2} maxLength={1200}/><button type="button" disabled={phase==="connecting"||!draft.trim()} onClick={send}>Отправить вопрос</button><button className="secondary" type="button" onClick={()=>void audio.current?.play()}>Воспроизвести звук</button></>:null}
    {lines.map((line,i)=><p className="quiet" key={i}>{line}</p>)}{error?<p className="error" role="alert">{error}</p>:null}
  </details></section>;
}
