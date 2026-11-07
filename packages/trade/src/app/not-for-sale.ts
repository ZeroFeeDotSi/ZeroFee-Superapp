// T2-5 (the copy review's walk, 8 Nov): a coin ZeroFee won't buy says "Not for sale" on its list row, in mute, where Buy was. What
// is known here is only what the app has proven: Solana's mint checks (the list's own refused read) and a coin page's
// refusal (the coin's own sell check on BNB Chain and Robinhood Chain), kept for this run of the app. Nothing is asked
// per row: a row not known yet keeps Buy, and Buy's own quote still refuses what can't be sold.
import { useSyncExternalStore } from "react";

const known = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const key = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`;

/** A coin page found this coin refused (coin-refusal.ts pageRefusal): its list rows say so from now on. */
export function markNotForSale(chain: string, address: string): void {
  const k = key(chain, address);
  if (known.has(k)) return;
  known.add(k);
  version++;
  for (const f of subs) f();
}
export const isNotForSale = (chain: string, address: string): boolean => known.has(key(chain, address));
/** The rows re-read when a coin is marked (one number, so a row re-renders only when the set changed). */
export function useNotForSale(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version, () => version);
}
/** The row's words, in place of Buy. */
export const NOT_FOR_SALE = "Not for sale";

/** The quote's refusal of a coin no one could sell back (trade-problems.ts coinUnsellable). */
export const UNSELLABLE = "trade.coin.unsellable";
/** A quote refused a coin as unsellable (an unseen trap coin, the audit's note): its list rows say "Not for sale" from now on. */
export function markIfUnsellable(code: string | undefined, chain: string, address: string): void {
  if (code === UNSELLABLE) markNotForSale(chain, address);
}
