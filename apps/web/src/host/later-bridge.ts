// A core whose code loads on its first use (D134): the phone's page runs its core in Swift's own context, so the page's
// own core (DemoCore, SecondDeviceCore) is never in its first load; a browser loads it as the app first asks.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

const UNLOADED: Problem = { code: "shell.core.unloaded", whatHappened: "ZeroFee's code didn't load. Try again.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };

/** `make` runs once, on the first call or listener; a failed load is tried again on the next call. Listeners added
 *  before it is made are attached the moment it is. */
export function laterBridge(make: () => Promise<Bridge>): Bridge {
  let made: Bridge | null = null;
  let making: Promise<Bridge> | null = null;
  const subs = new Set<{ event: string; handler: (payload: never) => void; off?: () => void }>();
  const get = () =>
    (making ??= make().then(
      (b) => {
        made = b;
        for (const s of subs) s.off = b.on(s.event, s.handler);
        return b;
      },
      (e: unknown) => {
        making = null;
        throw e;
      },
    ));
  return {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      return made ? made.call<T>(method, params) : get().then((b) => b.call<T>(method, params), (): BridgeResult<T> => ({ problem: UNLOADED }));
    },
    on<T>(event: string, handler: (payload: T) => void) {
      const s: { event: string; handler: (payload: never) => void; off?: () => void } = { event, handler: handler as (payload: never) => void };
      subs.add(s);
      if (made) s.off = made.on(event, handler);
      else get().catch(() => undefined);
      return () => {
        subs.delete(s);
        s.off?.();
      };
    },
  };
}
