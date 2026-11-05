// Spending's one engine, hosted for the shell (D52): Trade's own runtime (the market, the engines and the float planner),
// on the very bridge the Trade app gets, so the app's screens and Spending see one planner and one move journal, never
// two. The shell starts it once the account is home (any app on screen), not when Trade opens (H23), and stops it when
// the page locks or leaves. Off screen it pauses (iOS suspends a backgrounded app): what's on its way on chain finishes
// by itself, and a step the phone signs (a private gap's move, an older wallet's drain, a Put away) waits, resumed from
// the journal when the app is back; `settle` is the step under way, which Swift lets finish before iOS suspends the app.
import type { Bridge } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService } from "@zerofee/core/spending";
import { runtimeFor, setAppRuntime } from "./runtime.ts";

const asCall = (b: () => Bridge) => async <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
  const r = await b().call<T>(method, params);
  if ("problem" in r) throw new ProblemError(r.problem);
  return r.ok;
};

/**
 * `tradeBridge`: the Trade app's own bridge (asked lazily: it is built on the bridge this service is part of).
 * `base`: the core, the device and Wallet's ledger as Trade (forApps(…, "trade")): what Spending reads and asks through.
 * One wallet per chain (D55): Trade's bridge reaches every chain wallet, so there is no separate sites' bridge.
 */
export function hostSpending(tradeBridge: () => Bridge, base: () => Bridge): Bridge & { start(): () => void; settle(): Promise<void> } {
  const engine = () => {
    const rt = runtimeFor(tradeBridge());
    // Wallet's "In trading" (trade.holdings) reads this very engine, with its moves on their way, before Trade opens
    setAppRuntime(rt);
    return rt.float;
  };
  // Home's Swap of a coin inside one wallet: a trade on Trade's own engines (swap-door.ts, loaded with its first ask, never
  // in Home's first load), behind Spending's one table of callers
  const service = createSpendingService({ engine, call: asCall(base), nativeUsd: (chain) => runtimeFor(tradeBridge()).market.nativeUsd(chain), swap: (m, p) => import("./swap-door.ts").then((x) => x.swapCall(() => runtimeFor(tradeBridge()), m, p)) });
  return {
    call: service.call,
    on: service.on,
    // the cap kept on this phone is read before the engine's first round, so it never plans past it
    start: () => {
      let stop: (() => void) | undefined, gone = false, ready = false;
      const doc = (globalThis as { document?: Document }).document;
      const go = () => { if (ready && !gone && !stop && doc?.visibilityState !== "hidden") stop = engine().start(); };
      const pause = () => { stop?.(); stop = undefined; };
      const seen = () => (doc?.visibilityState === "hidden" ? pause() : go());
      doc?.addEventListener("visibilitychange", seen);
      void service.ready().then(() => { ready = true; go(); });
      return () => { gone = true; pause(); doc?.removeEventListener("visibilitychange", seen); };
    },
    settle: () => engine().settle(),
  };
}
