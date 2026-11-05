// Every 1Click quote request's `deadline` (privacy MUST P7, QA, 5 Nov): 1Click copies it to the millisecond
// into its public withdraw intent on NEAR, so a deadline stamped from our clock tells a chain watcher when we asked
// and pairs it with the Safe's own tx a few seconds later. Rounded UP to the next 5-minute mark (:00, :05 … :55, 0 s,
// 0 ms), every ask in the same five minutes carries the same deadline. Up only: a quote lives its asked life and at
// most 5 minutes more (QUOTE_DEADLINE_STEP_MS), which every "lasts longer than asked" check allows for.

/** The grid every 1Click quote request's deadline sits on. */
export const QUOTE_DEADLINE_STEP_MS = 5 * 60_000;

/** The deadline (ISO) for a 1Click quote asked at `nowMs` that must live at least `minLifeMs`: the next 5-minute mark. */
export function quoteDeadline(nowMs: number, minLifeMs: number): string {
  if (!Number.isFinite(nowMs) || !Number.isFinite(minLifeMs) || minLifeMs < 0) throw new RangeError("quoteDeadline: a time and a life");
  const least = nowMs + minLifeMs;
  return new Date(Math.ceil(least / QUOTE_DEADLINE_STEP_MS) * QUOTE_DEADLINE_STEP_MS).toISOString();
}
