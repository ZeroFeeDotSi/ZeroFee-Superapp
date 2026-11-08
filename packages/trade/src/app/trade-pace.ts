// Builder 22's item 6 (8 Nov): a trade's Jobs row took a fixed guess for its time left (the sheet's SALE_SEC, 2 s on every
// chain) or none at all (a Trenches row's Buy chip: "No time estimate"). Now a trade's time left from its first frame is
// this device's own measured pace on that chain, the measured-legs rule: the median tap-to-landed time (service.ts
// landedMs) of its last PACE_RUNS landed trades there; with none landed yet, the chain's speed bar (rule 3: Solana under
// 1 s, NEAR and Robinhood Chain about 2 s). Read from Trade's own records, kept in step with each change, so the tap
// reads it at once (rule 2).
import { landedMs, type TradeRecord, type TradeService } from "../service.ts";
import type { ChainId } from "../types.ts";

/** The speed bar per chain (RULES rule 3), the first guess before this device has landed a trade there. */
export const BAR_MS: Record<ChainId, number> = { sol: 1_000, hood: 2_000, near: 2_000, bsc: 2_000 };
/** How many of the chain's last landed trades the pace reads. */
export const PACE_RUNS = 5;

/** The chain's pace, in ms, from `records` (newest first, as Trade keeps them): the median of the last PACE_RUNS landed
 *  buys and sells there; the chain's bar when none landed. Pure. */
export function tradePaceMs(records: readonly TradeRecord[], chain: ChainId): number {
  const ms: number[] = [];
  for (const r of records) {
    if (ms.length >= PACE_RUNS) break;
    if (r.chain !== chain || (r.kind !== "buy" && r.kind !== "sell") || r.status !== "done") continue;
    const m = landedMs(r);
    if (m !== undefined && Number.isFinite(m) && m > 0) ms.push(m);
  }
  if (!ms.length) return BAR_MS[chain] ?? 2_000;
  const s = [...ms].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

/** Each service's paces by chain, read from its records and read again on each change. */
const PACES = new WeakMap<object, Map<ChainId, number>>();

/** Keep `svc`'s paces in step with its records: one reader per service, for the page's life. */
export function keepPace(svc: Pick<TradeService, "on" | "activity">): void {
  if (PACES.has(svc)) return;
  const paces = new Map<ChainId, number>();
  PACES.set(svc, paces);
  const read = () => void svc.activity().then((all) => { for (const c of Object.keys(BAR_MS) as ChainId[]) paces.set(c, tradePaceMs(all, c)); }, () => undefined);
  read();
  svc.on(read);
}

/** When a trade tapped at `at` (epoch ms) on `chain` should land: the chain's measured pace, else its bar. */
export function tradeEndsAt(svc: Pick<TradeService, "on" | "activity">, chain: ChainId, at: number): number {
  keepPace(svc);
  return at + (PACES.get(svc)?.get(chain) ?? BAR_MS[chain] ?? 2_000);
}
