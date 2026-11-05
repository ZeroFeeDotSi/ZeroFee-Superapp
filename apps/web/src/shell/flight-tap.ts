// The test flight recorder's tap on the shell's one bridge (core.ts shellBridge). core.ts wraps the bridge with it
// ONLY when the build turns the recorder on (VITE_TEST_TRACE=1, never the public build): otherwise nothing references
// this module and the bundler drops it. What it notes of a call is the method's name, how long it took, and ok or the
// Problem's code and whatHappened: never the call's params, never its result.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

/** One bridge call, as the recorder sees it. */
export interface CallNote {
  method: string;
  ms: number;
  code?: string;
  what?: string;
  threw?: string;
}

let sink: ((n: CallNote) => void) | null = null;
/** Calls made before the recorder's code arrived (it loads after the first screen): the first 100. */
const early: CallNote[] = [];

/** flight.ts: where each call's note goes from now on (the ones already made first). */
export function setFlightSink(f: ((n: CallNote) => void) | null): void {
  sink = f;
  if (f) for (const n of early.splice(0)) f(n);
}

const note = (n: CallNote) => {
  if (sink) sink(n);
  else if (early.length < 100) early.push(n);
};

/** The bridge, unchanged in what it answers, with each call noted. Events (`on`) pass straight through. */
export function flightBridge(inner: Bridge): Bridge {
  return {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      const t0 = performance.now();
      let res: BridgeResult<T>;
      try {
        res = await inner.call<T>(method, params);
      } catch (e) {
        note({ method, ms: Math.round(performance.now() - t0), threw: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      const ms = Math.round(performance.now() - t0);
      const p = res && typeof res === "object" && "problem" in res ? res.problem : null;
      note(p ? { method, ms, code: String(p.code ?? ""), what: String(p.whatHappened ?? "") } : { method, ms });
      return res;
    },
    on: inner.on.bind(inner),
  };
}
