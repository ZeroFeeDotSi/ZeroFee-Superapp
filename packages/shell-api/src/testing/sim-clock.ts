// Tests only: the Sim's timed steps on the test's own clock, never the wall's. MockBridge's `timers` (a movement settling,
// a credit, a Private pay landing) and the float's `float.timers` (a move landing) take `clock.timers`; nothing then runs
// until the test moves the clock on. A busy machine (the land gate's full suite) used to let a 5 ms step land before the
// test read "on its way", or not yet land inside a 40 ms wait; now the order is the steps' own due times, every run.
import type { createMockBridge } from "../MockBridge.ts";

type Held = { at: number; seq: number; run: () => void };

/** Three turns of the event loop with no bridge call in flight: the engine's own steps are done (a count, not a wait). */
const turn = () => new Promise<void>((r) => (globalThis as unknown as { setImmediate(run: () => void): void }).setImmediate(r));
async function quietOf(busy: () => number): Promise<void> {
  for (let quiet = 0; quiet < 3; ) {
    await turn();
    quiet = busy() === 0 ? quiet + 1 : 0;
  }
}

/**
 * The clock, and `watch(mock)`: counts the bridge's calls in flight (every caller's: the engine's, Spending's, a test's own
 * listener), so `quiet()` resolves once they are all answered. `advance(ms)`: that much of the test's time goes by; each
 * step due runs in its due order (a step it arms runs too when due by then), and the calls it starts are answered before
 * the next runs, as on an idle machine.
 */
export function simClock() {
  let now = 0, seq = 0, busy = 0;
  const held: Held[] = [];
  const timers = {
    set: (run: () => void, ms: number): unknown => { const h: Held = { at: now + Math.max(0, ms || 0), seq: ++seq, run }; held.push(h); return h; },
    clear: (h: unknown): void => { const i = held.indexOf(h as Held); if (i >= 0) held.splice(i, 1); },
  };
  const quiet = () => quietOf(() => busy);
  return {
    timers,
    quiet,
    /** How many steps wait on the clock. */
    held: () => held.length,
    watch<M extends Pick<ReturnType<typeof createMockBridge>, "call">>(mock: M): M {
      const call = mock.call.bind(mock) as M["call"];
      mock.call = (async (...a: Parameters<M["call"]>) => { busy++; try { return await (call as (...x: unknown[]) => Promise<unknown>)(...a); } finally { busy--; } }) as M["call"];
      return mock;
    },
    async advance(ms: number): Promise<void> {
      const until = now + ms;
      for (;;) {
        held.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = held[0];
        if (!next || next.at > until) break;
        held.shift();
        now = next.at;
        next.run();
        await quiet();
      }
      now = until;
    },
  };
}
