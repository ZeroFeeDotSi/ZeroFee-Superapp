// Which way a coin's price last moved, for a short moment after it moved: the list and the coin page flash a soft light
// under the number (up or down) instead of rolling its digits (small live numbers don't roll). Every price the
// screens are shown passes through note(); the first price of a coin is no move.
export type Tick = "up" | "down";
export const TICK_MS = 2_400;

export interface Ticks {
  /** A price shown for `key` (tickKey). */
  note(key: string, priceUsd: number | undefined): void;
  /** "up" or "down" for TICK_MS after the price last moved, else null. */
  get(key: string): Tick | null;
  /** Told when a key's tick starts or ends. Returns the unsubscribe. */
  subscribe(key: string, f: () => void): () => void;
}

export const tickKey = (chain: string, address: string): string => `${chain}:${/^0x/i.test(address) ? address.toLowerCase() : address}`;

export function createTicks(o: { now?: () => number; setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void } = {}): Ticks {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const last = new Map<string, number>();
  const moved = new Map<string, { dir: Tick; at: number; timer: unknown }>();
  const subs = new Map<string, Set<() => void>>();
  const tell = (k: string) => { for (const f of subs.get(k) ?? []) { try { f(); } catch { /* a listener's own problem */ } } };
  return {
    note(k, px) {
      if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) return;
      const before = last.get(k);
      last.set(k, px);
      if (before === undefined || before === px) return;
      // a change under a hundredth of a percent is the same price read twice through rounding: no flash
      if (Math.abs(px - before) / before < 1e-4) return;
      const was = moved.get(k);
      if (was) clearTimer(was.timer);
      const timer = setTimer(() => { moved.delete(k); tell(k); }, TICK_MS);
      moved.set(k, { dir: px > before ? "up" : "down", at: now(), timer });
      tell(k);
    },
    get(k) {
      const m = moved.get(k);
      return m && now() - m.at < TICK_MS ? m.dir : null;
    },
    subscribe(k, f) {
      let s = subs.get(k);
      if (!s) subs.set(k, (s = new Set()));
      s.add(f);
      return () => { s!.delete(f); if (!s!.size) subs.delete(k); };
    },
  };
}
