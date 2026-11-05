// AgentZero never hangs (product decision, 3 Nov).
// Every wait of AgentZero's OWN has a limit here, and ends with a plain line naming what didn't answer and that nothing
// moved; then the chat is usable again. One helper for all of them (no dependency).
//
// What is NEVER timed out here: the core's own sheets and signing (a money step is the person's, at their own pace), and a
// move being followed (it stays honest: pending, then "unseen"). A timeout only stops AgentZero WAITING; it never cancels
// or retries anything the core does.

/** The limits, in ms. Mutable only so the fault suite's page can shrink them (tools/agentzero-suite --faults). */
export const LIMITS = {
  /** A read of the core through the bridge (device store, ledger, spending, account views). */
  core: 8_000,
  /** A market or relay read (prices, trending, a dry quote, the free reading's sign-up). */
  read: 8_000,
  /** Claude's first event after the request goes. */
  firstByte: 30_000,
  /** Silence between two of Claude's events mid-stream. */
  gap: 45_000,
};

/** What didn't answer in time: `service` is named to the person. */
export class TimedOut extends Error {
  readonly service: string;
  readonly ms: number;
  constructor(service: string, ms: number) {
    super(`${service} didn't answer in time`);
    this.name = "TimedOut";
    this.service = service;
    this.ms = ms;
  }
}
export const isTimedOut = (e: unknown): e is TimedOut => e instanceof TimedOut || (!!e && typeof e === "object" && (e as { name?: unknown }).name === "TimedOut" && typeof (e as { service?: unknown }).service === "string");

/** The one line a limit ends with. */
export const timedOutLine = (service: string): string => `${service} didn't answer in time. Nothing moved. Try again.`;

/** Stop's own error: a wait the person stopped (never shown: a Stop says "Stopped" itself). */
export class Stopped extends Error {
  constructor() {
    super("stopped");
    this.name = "Stopped";
  }
}

/**
 * `p`, or TimedOut(service) after `ms`, or Stopped as soon as `signal` aborts. The work behind `p` is not cancelled (it
 * may be the core's); AgentZero only stops waiting for it. A late answer is dropped, and a late failure never surfaces
 * as an unhandled rejection.
 */
export function within<T>(p: PromiseLike<T> | T, ms: number, service: string, signal?: AbortSignal): Promise<T> {
  const work = Promise.resolve(p);
  work.then(undefined, () => undefined);
  if (signal?.aborted) return Promise.reject(new Stopped());
  return new Promise<T>((yes, no) => {
    let done = false;
    const off = () => {
      done = true;
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => !done && (off(), no(new Stopped()));
    const t = setTimeout(() => !done && (off(), no(new TimedOut(service, ms))), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then((v) => !done && (off(), yes(v)), (e) => !done && (off(), no(e)));
  });
}

/** `within`, but a timeout or failure answers `fallback` (a read whose absence the caller already handles). */
export const withinOr = <T, F>(p: PromiseLike<T> | T, ms: number, service: string, fallback: F, signal?: AbortSignal): Promise<T | F> =>
  within(p, ms, service, signal).catch((e) => (e instanceof Stopped ? Promise.reject(e) : fallback));

/**
 * A stream's events, each within its limit: the first within `first` ms of the start, every later one within `gap` ms of
 * the one before. Over a limit (or on `signal`), `onLate` runs (abort the request) and the loop throws TimedOut(service)
 * (or Stopped), whether or not the request's own abort ever reaches the stream.
 */
export async function* paced<T>(source: AsyncIterable<T>, o: { first: number; gap: number; service: string; signal?: AbortSignal; onLate?: () => void }): AsyncGenerator<T, void> {
  const it = source[Symbol.asyncIterator]();
  let limit = o.first;
  try {
    for (;;) {
      let r: IteratorResult<T>;
      try {
        r = await within(it.next(), limit, o.service, o.signal);
      } catch (e) {
        o.onLate?.();
        throw e;
      }
      if (r.done) return;
      limit = o.gap;
      yield r.value;
    }
  } finally {
    // the source is left to its own abort: a return() on a stuck iterator could wait forever too
    void Promise.resolve().then(() => it.return?.()).catch(() => undefined);
  }
}

/** One AbortController that also aborts when `parent` does (no AbortSignal.any: older iPhones' web views lack it). */
export function linked(parent?: AbortSignal): AbortController {
  const c = new AbortController();
  if (parent?.aborted) c.abort();
  else parent?.addEventListener("abort", () => c.abort(), { once: true });
  return c;
}
