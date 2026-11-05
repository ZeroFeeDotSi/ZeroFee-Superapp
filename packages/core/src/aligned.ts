// A timer on the clock's own beat (speed, 2 Nov). Two pollers with the same period (the core's recovery watcher, Wallet's
// balance poll) tick at the same moment, so their reads ask for the same final block at once and NodePace shares them:
// one head and one account read for both, where two timers out of step read everything twice.

/**
 * Run `fn` every `ms`, at the multiples of `ms` since the epoch (the next one first), until the returned stop is called.
 * Each tick is set from the clock again, so it never drifts from the beat. In Node a waiting tick keeps no process alive.
 */
export function everyAligned(ms: number, fn: () => void, now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    const t = now();
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      next();
      fn();
    }, ms - (t % ms) || ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  next();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
