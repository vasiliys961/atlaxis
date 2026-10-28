import { professorToolResult, type ProfessorCall } from "./professor-realtime-tool";
export type ProfessorRealtimePhase = "off" | "connecting" | "listening" | "hearing" | "thinking" | "consulting" | "playing";
type Options = { mode: "general" | "analysis"; microphone: boolean; ask: (question: string) => Promise<string | undefined>; onPhase: (phase: ProfessorRealtimePhase) => void; onLine: (id: string, role: "user" | "assistant", text: string) => void; onBlocked: (blocked: boolean) => void; onLatency: (ms: number) => void; onError: (message: string) => void };
export class ProfessorRealtime {
  private generation = 0;
  private stream?: MediaStream;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private audio?: HTMLAudioElement;
  private abort?: AbortController;
  private watchdog?: ReturnType<typeof setTimeout>;
  private cap?: ReturnType<typeof setTimeout>;
  private resume?: ReturnType<typeof setTimeout>;
  private cueTimer?: ReturnType<typeof setTimeout>;
  private cueWait?: Promise<void>;
  private cueResolve?: () => void;
  private cueId?: string;
  private cueNumber = 0;
  private lastCueAt = 0;
  private finishCue() { this.cueResolve?.(); this.cueResolve=undefined; this.cueWait=undefined; this.cueId=undefined; }
  private blocked = false;
  private processing = false;
  private playing = false;
  private busyResponse = false;
  private calls = new Set<string>();
  private options?: Options;
  private endedAt = 0;
  private hasAudio = false;
  private fromProfessor = false;
  private mute(value: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !value; }); }
  private send(event: object) { if (this.channel?.readyState !== "open") throw new Error("Голосовое соединение закрыто."); this.channel.send(JSON.stringify(event)); }
  private watch(id: number, ms = 70000) { clearTimeout(this.watchdog); this.watchdog = setTimeout(() => { if (this.generation === id) { this.stop(); this.options?.onError("Ответ не поступил вовремя. Подключитесь снова."); } }, ms); }
  private listen(id: number) {
    if (id !== this.generation || this.processing || this.playing) return;
    clearTimeout(this.watchdog); clearTimeout(this.resume);
    this.resume = setTimeout(() => { if (id !== this.generation || this.blocked || this.processing) return; this.busyResponse=false; this.send({type:"input_audio_buffer.clear"}); this.mute(false); this.options?.onPhase("listening"); }, 150);
  }
  async start(options: Options) {
    this.stop(); this.options = options; const id = this.generation; this.calls.clear(); this.blocked = false; this.processing = false; this.playing=false; this.busyResponse=false;
    const alive = () => this.generation === id;
    const fail = (message: string) => { if (alive()) { this.stop(); options.onError(message); } };
    options.onPhase("connecting"); options.onBlocked(false);
    try {
      const player = new Audio(); player.autoplay = true; player.setAttribute("playsinline","true"); this.audio = player;
      // Prime the same output element during the user's click, before network awaits.
      const bytes = new Uint8Array(44+1600), view = new DataView(bytes.buffer);
      const word=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);};
      word(0,"RIFF");view.setUint32(4,bytes.length-8,true);word(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,"data");view.setUint32(40,1600,true);
      const primer = URL.createObjectURL(new Blob([bytes],{type:"audio/wav"})); player.src = primer;
      void player.play().then(()=>{if(alive() && player.src===primer)player.pause();},()=>{}).finally(()=>URL.revokeObjectURL(primer));
      const peer = new RTCPeerConnection(); this.peer = peer;
      if (options.microphone) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Микрофон недоступен в этом браузере.");
        const request = navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        void request.then(stream=>{if(!alive())stream.getTracks().forEach(track=>track.stop());},()=>{});
        let timeout: ReturnType<typeof setTimeout>;
        const stream = await Promise.race([request,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("Разрешите микрофон для этой страницы и начните снова.")),15000);})]).finally(()=>clearTimeout(timeout));
        if (!alive()) {stream.getTracks().forEach(track=>track.stop());return;}
        this.stream=stream;this.mute(true);stream.getTracks().forEach(track=>{track.onended=()=>fail("Микрофон отключён. Начните разговор заново.");peer.addTrack(track,stream);});
      } else peer.addTransceiver("audio",{direction:"recvonly"});
      if (!alive()) return;
      peer.ontrack = event => { if(!alive())return;player.removeAttribute("src");player.srcObject=event.streams[0] || new MediaStream([event.track]);void player.play().then(()=>{if(alive()){this.blocked=false;options.onBlocked(false);}},()=>{if(alive()){this.blocked=true;this.mute(true);options.onBlocked(true);}}); };
      peer.onconnectionstatechange=()=>{if(alive() && ["failed","closed"].includes(peer.connectionState))fail("Голосовое соединение прервано.");};
      const channel=peer.createDataChannel("oai-events");this.channel=channel;
      channel.onopen=()=>{if(alive()){clearTimeout(this.watchdog);if(!this.blocked){this.mute(false);options.onPhase("listening");}}};
      channel.onclose=()=>fail("Голосовое соединение закрыто.");
      channel.onmessage=({data})=>{if(!alive())return;let event:any;try{event=JSON.parse(String(data));}catch{return;}
        if(event.type==="error"){fail("Ошибка OpenAI Realtime. Перезапустите разговор.");return;}
        if(event.type==="input_audio_buffer.speech_started"){this.fromProfessor=false;clearTimeout(this.resume);options.onPhase("hearing");}
        if(event.type==="input_audio_buffer.speech_stopped"){this.endedAt=performance.now();options.onPhase("thinking");}
        if(event.type==="conversation.item.input_audio_transcription.completed")options.onLine(event.item_id,"user",event.transcript || "");
        if(event.type==="response.created" && event.response?.metadata?.purpose==="wait_cue")this.cueId=event.response.id;
        if(event.type==="response.created"){this.busyResponse=true;this.hasAudio=false;this.mute(true);options.onPhase("thinking");this.watch(id);}
        if(event.type==="response.output_audio_transcript.done")options.onLine(event.response_id,"assistant",event.transcript || "");
        if(event.type==="response.output_audio.delta")this.hasAudio=true;
        if(event.type==="output_audio_buffer.started"){this.playing=true;this.hasAudio=true;this.mute(true);options.onPhase("playing");if(this.endedAt && !this.cueWait && (options.mode === "general" || this.fromProfessor))options.onLatency(Math.round(performance.now()-this.endedAt));}
        if(event.type==="output_audio_buffer.stopped" || event.type==="output_audio_buffer.cleared"){this.playing=false;if(this.cueWait && event.response_id===this.cueId)this.finishCue();this.listen(id);}
        if(event.type==="response.done" && event.response?.metadata?.purpose==="wait_cue") {
          const audio=event.response?.output?.some((item:any)=>item.content?.some((part:any)=>part.type==="audio" || part.type==="output_audio"));
          if(event.response?.status!=="completed" || !audio)this.finishCue();
          return;
        }
        if(event.type==="response.done"){
          if(event.response?.status==="failed"){fail("OpenAI не смог сформировать ответ. Проверьте API-баланс и доступ к модели.");return;}
          const calls:ProfessorCall[]=(event.response?.output || []).filter((item:any)=>item.type==="function_call" && item.call_id && !this.calls.has(item.call_id));
          if(calls.length){for(const call of calls)this.calls.add(call.call_id!);this.processing=true;this.mute(true);options.onPhase("consulting");this.watch(id,75000);
            // One neutral acknowledgment for slow calls; never a clinical claim or fake result.
            clearTimeout(this.cueTimer);
            this.cueTimer=setTimeout(()=>{
              if(!alive() || !this.processing || this.playing || Date.now()-this.lastCueAt<30000)return;
              this.lastCueAt=Date.now();
              const phrases=["Да, давайте разберём этот момент.","Хорошо, разберёмся по порядку.","Да, это стоит разобрать подробнее."];
              const phrase=phrases[this.cueNumber++ % phrases.length];
              this.cueWait=new Promise(resolve=>{this.cueResolve=resolve;});
              this.send({type:"response.create",response:{conversation:"none",input:[],metadata:{purpose:"wait_cue"},tools:[],tool_choice:"none",max_output_tokens:80,instructions:`Произнеси только эту фразу на русском, естественно и спокойно: «${phrase}». Ничего не добавляй. Не делай медицинских утверждений.`}});
            },1200);
            void (async()=>{for(const call of calls){const result=await professorToolResult(call,options.ask);if(!alive())return;this.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:call.call_id,output:JSON.stringify(result)}});}clearTimeout(this.cueTimer);await this.cueWait;if(!alive())return;this.processing=false;this.fromProfessor=true;
              this.send({type:"response.create",response:{tool_choice:"none",instructions:"Ты Профессор Атлаксиса. Произнеси готовый ответ последней функции ask_professor полностью и дословно, включая последнее предложение и предупреждения, без добавлений. Не сокращай и не пересказывай его. Не упоминай другого профессора или внутреннюю проверку. Сохрани числа, отрицания и ограничения. Если функция вернула ошибку, коротко сообщи об этом; не придумывай ответ."}});
            })().catch(()=>fail("Не удалось получить ответ профессора."));
          } else {
            const audio=this.hasAudio || event.response?.output?.some((item:any)=>item.content?.some((part:any)=>part.type==="audio" || part.type==="output_audio"));
            if(!audio && !this.processing)this.listen(id);
          }
        }
      };
      const offer=await peer.createOffer();await peer.setLocalDescription(offer);if(!alive())return;
      this.abort=new AbortController();
      const response=await fetch("/api/realtime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sdp:peer.localDescription?.sdp,kind:"professor",mode:options.mode}),signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(35000)])});
      const result=await response.json();if(!alive())return;if(!response.ok)throw new Error(result.error || "Не удалось подключить Realtime.");
      await peer.setRemoteDescription({type:"answer",sdp:result.answerSdp});if(!alive())return;
      if(channel.readyState!=="open")this.watch(id,15000);
      this.cap=setTimeout(()=>{if(alive()){this.stop();options.onError("Пятнадцатиминутная сессия завершена. Можно начать снова.");}},900000);
    } catch(error){fail(error instanceof Error ? error.message : "Не удалось начать голосовой разговор.");}
  }
  sendText(text:string) {const value=text.trim();if(!value || this.processing || this.busyResponse)return;this.fromProfessor=false;this.busyResponse=true;this.options?.onPhase("thinking");this.mute(true);this.endedAt=performance.now();this.send({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:value}]}});this.send({type:"response.create"});}
  async enableSound(){if(!this.audio)return false;try{await this.audio.play();this.blocked=false;this.options?.onBlocked(false);if(!this.processing && !this.playing)this.listen(this.generation);return true;}catch{return false;}}
  stop(){this.generation++;clearTimeout(this.watchdog);clearTimeout(this.cap);clearTimeout(this.resume);clearTimeout(this.cueTimer);this.finishCue();this.abort?.abort();this.abort=undefined;this.processing=false;this.playing=false;this.busyResponse=false;
    if(this.channel){this.channel.onopen=this.channel.onclose=this.channel.onmessage=null;this.channel.close();}this.channel=undefined;
    this.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.stream=undefined;
    if(this.peer){this.peer.ontrack=this.peer.onconnectionstatechange=null;this.peer.close();}this.peer=undefined;
    if(this.audio){this.audio.pause();this.audio.srcObject=null;this.audio.removeAttribute("src");this.audio.load();}this.audio=undefined;
    this.options?.onPhase("off");
  }
}
