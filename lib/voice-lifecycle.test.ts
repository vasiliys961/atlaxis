import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceRuns } from "./voice-lifecycle";
test("late microphone permission result is closed after Stop", () => {
  const sessions = new VoiceRuns(), old = sessions.begin()!;
  sessions.stop(); let closed = 0;
  old.addCleanup(() => closed++);
  assert.equal(closed, 1); assert.equal(old.abort.signal.aborted, true);
});
test("old turn completion cannot stop a restarted conversation", () => {
  const sessions = new VoiceRuns(), old = sessions.begin()!;
  sessions.stop(); const fresh = sessions.begin()!; let closed = false;
  fresh.addCleanup(() => { closed = true; });
  assert.equal(sessions.finish(old), false); assert.equal(sessions.owns(fresh), true); assert.equal(closed, false);
  sessions.finish(fresh); assert.equal(closed, true);
});
test("repeated cleanup runs once and survives a failing resource", () => {
  const sessions = new VoiceRuns(), run = sessions.begin()!; let stopped = 0;
  run.addCleanup(() => { throw new Error("already closed"); }); run.addCleanup(() => stopped++);
  sessions.stop(); sessions.stop(); sessions.finish(run);
  assert.equal(stopped, 1); assert.equal(sessions.current, undefined);
});
test("double Start does not create a second capture", () => {
  const sessions = new VoiceRuns(); const first = sessions.begin()!;
  assert.equal(sessions.begin(), undefined); assert.equal(sessions.current, first);
});

test("request timeout still releases microphone and audio resources", () => {
  const sessions = new VoiceRuns(), run = sessions.begin()!; let closed = 0;
  run.addCleanup(() => closed++); run.abort.abort();
  sessions.finish(run); assert.equal(closed, 1); assert.equal(sessions.current, undefined);
});
