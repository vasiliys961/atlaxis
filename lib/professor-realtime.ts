export type VoicePhase = "off" | "connecting" | "listening" | "transcribing";
type Options = {
  onTranscript: (text: string) => void;
  onSpeech: () => void;
  onPhase: (phase: VoicePhase) => void;
  onError: (message: string) => void;
};

/** Microphone → Realtime transcript only. Medical answers never originate here. */
export class ProfessorRealtime {
  private generation = 0;
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private abort: AbortController | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  stop() {
    this.generation++;
    this.abort?.abort(); this.abort = null;
    if (this.timeout) clearTimeout(this.timeout);
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.timeout = this.sessionTimer = null;
    if (this.channel) { this.channel.onclose = null; this.channel.close(); }
    this.channel = null;
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.close(); }
    this.peer = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  async start(options: Options) {
    this.stop();
    const token = this.generation;
    const alive = () => token === this.generation;
    const fail = (message: string) => {
      if (!alive()) return;
      this.stop(); options.onPhase("off"); options.onError(message);
    };
    options.onPhase("connecting");
    const seen = new Set<string>();
    const order: string[] = [];
    const completed = new Map<string, string>();
    const flush = () => {
      while (order.length && completed.has(order[0])) {
        const id = order.shift()!;
        const text = completed.get(id)!;
        completed.delete(id);
        if (text.trim()) options.onTranscript(text.trim().slice(0, 1500));
      }
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
        throw new Error("Браузер не поддерживает живой разговор. Используйте письменный ввод.");
      const streamRequest = navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      // A late permission grant must not leave the microphone running after Stop.
      void streamRequest.then(stream => { if (!alive()) stream.getTracks().forEach(track => track.stop()); }, () => {});
      this.timeout = setTimeout(() => fail("Истекло время доступа к микрофону или подключения."), 30_000);
      const stream = await streamRequest;
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const peer = new RTCPeerConnection(); this.peer = peer;
      stream.getTracks().forEach(track => {
        track.onended = () => fail("Микрофон отключён.");
        peer.addTrack(track, stream);
      });
      const channel = peer.createDataChannel("oai-events"); this.channel = channel;
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") fail("Голосовое соединение потеряно.");
      };
      channel.onopen = () => {
        if (!alive()) return;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        options.onPhase("listening");
        this.sessionTimer = setTimeout(() => fail("Разговор завершён через 10 минут. Можно подключиться снова."), 600_000);
      };
      channel.onclose = () => fail("Голосовое соединение закрыто.");
      channel.onmessage = ({ data }) => {
        if (!alive()) return;
        let event;
        try { event = JSON.parse(String(data)); } catch { return; }
        if (event.type === "error") { fail("Ошибка распознавания речи. Письменный чат доступен."); return; }
        if (event.type === "input_audio_buffer.speech_started") {
          options.onSpeech(); options.onPhase("listening");
        }
        if (event.type === "input_audio_buffer.speech_stopped") options.onPhase("transcribing");
        if (event.type === "input_audio_buffer.committed" && typeof event.item_id === "string" && !seen.has(event.item_id)) {
          seen.add(event.item_id); order.push(event.item_id); flush();
        }
        if (event.type === "conversation.item.input_audio_transcription.failed") {
          fail("Не удалось распознать фразу. Введите вопрос текстом."); return;
        }
        if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.item_id === "string" && typeof event.transcript === "string") {
          if (!seen.has(event.item_id)) { seen.add(event.item_id); order.push(event.item_id); }
          // A completed duplicate must not submit the same question twice.
          if (!order.includes(event.item_id)) return;
          completed.set(event.item_id, event.transcript); flush();
          options.onPhase("listening");
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (!alive()) return;
      this.abort = new AbortController();
      const response = await fetch("/api/professor/realtime", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp: peer.localDescription?.sdp }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(35_000)]),
      });
      const answer = await response.json();
      if (!alive()) return;
      if (!response.ok || !answer.answerSdp) throw new Error(answer.error || "Не удалось подключить голос.");
      await peer.setRemoteDescription({ type: "answer", sdp: answer.answerSdp });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Не удалось включить живой разговор.");
    }
  }
}
