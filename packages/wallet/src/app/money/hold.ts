// The hold behind Hold to send (the Home plan §1.3, §6), apart from the screen so a test drives its timer by hand.
import type { Bridge } from "@zerofee/core/bridge";

/** How long the finger stays down before it counts (about 0.6 s: long enough not to slip, short enough not to wait). */
export const HOLD_MS = 600;

export type HoldTimers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
export const REAL_TIMERS: HoldTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
export type Buzz = "tap" | "success" | "warning";

/** A buzz the person feels, through the shell's own haptic bridge; a phone without one says nothing (never a line). */
export const buzz = (bridge: Pick<Bridge, "call"> | undefined, kind: Buzz) => void bridge?.call("device.haptic", { kind }).catch(() => undefined);

/**
 * `start` on the finger down (a tap buzz), `stop` on any let-go before HOLD_MS (nothing happens), and once HOLD_MS has
 * passed with the finger still down, a success buzz and `done`, once. A second start while holding, or a start while
 * the control is off, does nothing.
 */
export function createHold(o: { timers: HoldTimers; feel: (kind: Buzz) => void; done: () => void; changed?: (holding: boolean) => void }) {
  let timer: unknown = null;
  return {
    holding: () => timer !== null,
    start(disabled = false) {
      if (disabled || timer !== null) return;
      o.changed?.(true);
      o.feel("tap");
      timer = o.timers.set(() => {
        timer = null;
        o.changed?.(false);
        o.feel("success");
        o.done();
      }, HOLD_MS);
    },
    stop() {
      if (timer === null) return;
      o.timers.clear(timer);
      timer = null;
      o.changed?.(false);
    },
  };
}
