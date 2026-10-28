/** Owns only one voice run. Late async results must attach resources to their original run. */
export class VoiceRun {
  readonly abort = new AbortController();
  private closed = false;
  private callbacks = new Set<() => void>();
  get stopped() { return this.abort.signal.aborted; }
  addCleanup(callback: () => void) {
    if (this.stopped) { callback(); return () => {}; }
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    for (const callback of this.callbacks) { try { callback(); } catch {} }
    this.callbacks.clear();
  }
}
export class VoiceRuns {
  current?: VoiceRun;
  begin() { if (this.current) return undefined; const run = new VoiceRun(); this.current = run; return run; }
  owns(run: VoiceRun) { return this.current === run && !run.stopped; }
  finish(run: VoiceRun) { run.stop(); if (this.current !== run) return false; this.current = undefined; return true; }
  stop() { const run = this.current; this.current = undefined; run?.stop(); }
}
