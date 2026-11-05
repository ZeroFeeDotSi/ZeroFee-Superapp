// A test's own clock for a screen's later timers. While held, every setTimeout of at least `fromMs` is kept and never runs,
// as if the clock stopped short of it; shorter ones (the fake runtime's turns) run as before. A screen mounted on a loaded
// machine then shows what it shows on an idle one, never what its 1.5 s or 2 s timers bring in (the gate, 5 Nov: a mount
// that took 10 s under load had its 2 s re-read and its 5 s "didn't answer" fire before the test looked). No waiting on
// the wall clock either way. `intervals`: every setInterval is held too (a 1 s tick under a 10 s mount ran ten times).
// Returns the undo.
export function holdTimers(fromMs: number, o: { intervals?: boolean } = {}): () => void {
  const real = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  globalThis.setTimeout = ((run: () => void, ms?: number, ...args: unknown[]) => ((ms ?? 0) >= fromMs ? { held: ms } : real(run, ms, ...args))) as typeof setTimeout;
  if (o.intervals) globalThis.setInterval = ((_run: () => void, ms?: number) => ({ held: ms })) as unknown as typeof setInterval;
  return () => { globalThis.setTimeout = real; globalThis.setInterval = realInterval; };
}
