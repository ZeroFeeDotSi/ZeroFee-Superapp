// the audit's Send audit M5 (7 Nov): Home's Swap asked its price once and kept it while the sheet sat: ten minutes on, "About
// 4.86 USDC arrives" and "Fees · about $0.14" still showed, and the tap put that figure on the receipt. Now, as
// InplaceSwap does (item 9), the price shown is asked again every SWAP_REFRESH_MS while the sheet is open (the shown one
// stays until the new one comes), it greys once it is PRICE_KEPT_MS old with nothing newer, and a tap on a price that
// old asks again first: the tap's figure is never a stale one. Pure, its own timers: a test drives the clock.
import { PRICE_KEPT_MS } from "./price-kept.ts";

/** How often a shown Swap price is asked again while the sheet sits (half its life, so a fresh one comes first). */
export const SWAP_REFRESH_MS = PRICE_KEPT_MS / 2;
/** Whether a price got at `at` is still the one to show and tap on. */
export const priceFresh = (at: number, now: number): boolean => now - at < PRICE_KEPT_MS;

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (t: unknown) => void };
/**
 * From the first price shown: asks again every SWAP_REFRESH_MS (`ask`: a fresh price, or null for none); a new one is
 * handed to `got`, and `stale` is told when the one shown reaches PRICE_KEPT_MS with nothing newer. One ask at a time.
 * Returns the stop (the sheet closed, or its coins or amount changed).
 */
export function keepFresh<T>(o: { ask: () => Promise<T | null>; got: (c: T) => void; stale: () => void; timers?: Timers }): () => void {
  const t: Timers = o.timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (x) => globalThis.clearTimeout(x as ReturnType<typeof setTimeout>) };
  let live = true, again: unknown, old: unknown;
  const aged = () => { t.clearTimeout(old); old = t.setTimeout(() => { if (live) o.stale(); }, PRICE_KEPT_MS); };
  const next = () => {
    again = t.setTimeout(() => void o.ask().then((c) => { if (!live) return; if (c !== null) { o.got(c); aged(); } next(); }, () => { if (live) next(); }), SWAP_REFRESH_MS);
  };
  aged();
  next();
  return () => { live = false; t.clearTimeout(again); t.clearTimeout(old); };
}
