// A price a money sheet already has (1Click's dry quote, through the core): asked again with the same inputs within
// PRICE_KEPT_MS, it is the one it got, never a second ask (product decision, 3 Nov: a Try again, or the sheet opened
// again, waited on 1Click a second time for the price it had just shown). Kept per bridge (one per app on the phone).
// Display only: the move itself always asks its own real quote afresh.

/** How long a price is kept: well inside a dry quote's own life (1Click's prices move within a minute). */
export const PRICE_KEPT_MS = 30_000;

const byBridge = new WeakMap<object, Map<string, { at: number; value: unknown }>>();
const of = (bridge: object) => {
  let m = byBridge.get(bridge);
  if (!m) byBridge.set(bridge, (m = new Map()));
  return m;
};

/** The price `bridge` kept for `key`, while it is fresh. */
export function keptPrice<T>(bridge: object, key: string, now: number = Date.now()): T | undefined {
  const kept = of(bridge);
  const k = kept.get(key);
  if (!k) return undefined;
  if (now - k.at >= PRICE_KEPT_MS) {
    kept.delete(key);
    return undefined;
  }
  return k.value as T;
}

/** Keeps `value` as `bridge`'s price for `key` (at most 50 kept: the oldest goes first). */
export function keepPrice(bridge: object, key: string, value: unknown, now: number = Date.now()): void {
  const kept = of(bridge);
  kept.delete(key);
  kept.set(key, { at: now, value });
  while (kept.size > 50) kept.delete(kept.keys().next().value!);
}
