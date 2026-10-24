import test from "node:test";
import assert from "node:assert/strict";
import { ProfessorRealtime } from "./professor-realtime";
import { professorRealtimeSession, validSdp } from "./professor-realtime-session";

test("microphone session cannot automatically generate medical answers", () => {
  const session = professorRealtimeSession();
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.equal(session.audio.input.turn_detection.interrupt_response, false);
  assert.deepEqual(session.output_modalities, ["text"]);
  assert.ok(validSdp("v=0\r\n"));
  assert.equal(validSdp("secret"), false);
  assert.equal(validSdp("v=" + "x".repeat(100_000)), false);
});

function fixture(microphone?: Promise<MediaStream>) {
  let stopped = 0;
  const track = { stop() { stopped++; }, onended: null };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const channel = {
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    close() {},
  };
  class Peer {
    connectionState = "connected";
    onconnectionstatechange = null;
    localDescription = { sdp: "v=0\r\n" };
    addTrack() {}
    createDataChannel() { return channel; }
    async createOffer() { return this.localDescription; }
    async setLocalDescription() {}
    async setRemoteDescription() { channel.onopen?.(); }
    close() {}
  }
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  function replace(name: string, value: unknown) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  replace("navigator", { mediaDevices: { getUserMedia: () => microphone ?? Promise.resolve(stream) } });
  replace("window", { RTCPeerConnection: Peer });
  replace("RTCPeerConnection", Peer);
  replace("fetch", async () => Response.json({ answerSdp: "v=0\r\n" }));
  return {
    stream,
    stopped: () => stopped,
    event(value: unknown) { channel.onmessage?.({ data: JSON.stringify(value) }); },
    restore() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("ordered transcripts submit once, and speech can interrupt the avatar", async () => {
  const f = fixture();
  const client = new ProfessorRealtime();
  const questions: string[] = [];
  let interruptions = 0;
  try {
    await client.start({ onTranscript: q => questions.push(q), onSpeech: () => interruptions++, onPhase() {}, onError: message => assert.fail(message) });
    f.event({ type: "input_audio_buffer.speech_started" });
    f.event({ type: "input_audio_buffer.committed", item_id: "one" });
    f.event({ type: "input_audio_buffer.committed", item_id: "two" });
    f.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "two", transcript: "Второй вопрос" });
    assert.deepEqual(questions, []);
    f.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "one", transcript: "Первый вопрос" });
    f.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "one", transcript: "Дубликат" });
    assert.deepEqual(questions, ["Первый вопрос", "Второй вопрос"]);
    assert.equal(interruptions, 1);
    client.stop();
    assert.equal(f.stopped(), 1);
    f.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "late", transcript: "Поздний вопрос" });
    assert.equal(questions.length, 2);
  } finally { client.stop(); f.restore(); }
});

test("Stop closes a microphone permission grant that arrives late", async () => {
  let grant!: (stream: MediaStream) => void;
  const mic = new Promise<MediaStream>(resolve => { grant = resolve; });
  const f = fixture(mic);
  const client = new ProfessorRealtime();
  try {
    const starting = client.start({ onTranscript() { assert.fail("must not submit"); }, onSpeech() {}, onPhase() {}, onError() { assert.fail("cancel is not an error"); } });
    client.stop();
    grant(f.stream);
    await starting;
    assert.ok(f.stopped() >= 1);
  } finally { client.stop(); f.restore(); }
});
