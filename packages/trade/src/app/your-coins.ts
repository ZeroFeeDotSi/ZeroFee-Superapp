// T-5 (master plan Part 1 §4, landing 1): "Your coins" on a chain's market, dollars first, with what each made or lost
// since it was bought. The cost is Trade's own average cost (service.ts applyFill: every buy's dollars and fee in, each
// sale takes out its share), kept on the device. Never a made-up number: no record of the buy says so, and a price that
// can't be read is "—", never $0.
import type { Position } from "../service.ts";
import type { ChainId } from "../types.ts";
import { change, usd, usdChange } from "./format.ts";

export const NO_RECORD = "Bought before ZeroFee kept a record";
export const NO_PRICE = "Its price can't be read right now";

/** The coins held on `chain` (above zero), most valuable first; a coin with no price after those with one. */
export function heldOn(chain: ChainId, positions: Position[]): Position[] {
  return positions
    .filter((p) => p.chain === chain && /^\d+$/.test(p.raw) && BigInt(p.raw) > 0n)
    .sort((a, b) => (Number.isFinite(b.valueUsd) ? b.valueUsd! : -1) - (Number.isFinite(a.valueUsd) ? a.valueUsd! : -1));
}

/** A value the screens may show: a number, not below zero, short of any real coin's worth (a hostile price is not). */
// past a billion dollars a coin's value is no real holding here: a scam coin's price (review 2, M3)
const priced = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;
/** A cost Trade recorded for the coin's buys (none, or not a sane number: no record). */
// under a cent is no cost basis to measure against (a near-zero cost made "+$25.00" from nothing: review 2, M3)
const recorded = (c: unknown): c is number => typeof c === "number" && Number.isFinite(c) && c >= 0.01 && c < 1e9;
/** To the cent, so float noise never reads as "+<$0.000001" (review 2, L4). */
const cents = (n: number) => Math.round(n * 100) / 100;
/** "+$6.10 +17.4%": the result against the cost; a percent past a million (a cost of almost nothing) is left out. */
const result = (value: number, cost: number) => {
  const pnl = cents(value - cost), pct = (pnl / cost) * 100;
  return change(pnl, Math.abs(pct) < 1e6 ? pct : undefined);
};

/** One row's words: its value now, and its result since bought (or why there is none). */
export function coinRowWords(p: Position): { value: string; since: string } {
  // a value that is no number, below zero or past any real coin's worth (a hostile price) is unpriced (review L2)
  if (!priced(p.valueUsd)) return { value: "—", since: NO_PRICE };
  if (!recorded(p.costUsd)) return { value: usd(p.valueUsd), since: NO_RECORD };
  return { value: usd(p.valueUsd), since: `${result(p.valueUsd, p.costUsd)} since you bought` };
}

/** T-5 landing 2: the chain's total over its priced coins, and their result since bought where Trade has the buys:
 *  "Solana coins $96.40 · +$9.80 since you bought". Null when nothing held has a price. */
export function chainTotalLine(chainName: string, held: Position[]): string | null {
  const shown = held.filter((p) => priced(p.valueUsd));
  if (!shown.length) return null;
  const value = shown.reduce((n, p) => n + p.valueUsd!, 0);
  const bought = shown.filter((p) => recorded(p.costUsd));
  const head = `${chainName} coins ${usd(value)}`;
  if (!bought.length) return head;
  // the result covers only coins Trade has the buys of; when some have none, it says so (review 2, L5)
  const tail = bought.length === shown.length ? "since you bought" : "on coins bought here";
  return `${head} · ${usdChange(cents(bought.reduce((n, p) => n + (p.valueUsd! - p.costUsd), 0)))} ${tail}`;
}

/** T-5 landing 2: the coin page's line under "Your position", the same words as its row, from the same numbers: the
 *  position's own amount (every wallet's, the amount its cost is for) at the page's price (review 2, M2). `position`:
 *  undefined while it loads (no line yet: never a false "no record", review 2, M1), null when Trade has none. Nothing when
 *  the price can't be read or is zero. `traded`: Trade's market buys this chain's coins. Where it doesn't (NEAR: bought in Home's
 *  swap, which keeps no cost here), no record says nothing about when it was bought, so no line (real-tap proof, 6 Nov, G05:
 *  "Bought before ZeroFee kept a record" on a coin bought seconds before). */
export function coinPageSince(position: Position | null | undefined, px: number | undefined, traded = true): { label: string; text: string } | { note: string } | null {
  if (position === undefined || !(typeof px === "number" && px > 0 && Number.isFinite(px))) return null;
  if (position === null) return traded ? { note: NO_RECORD } : null;
  if (!/^\d+$/.test(position.raw) || !Number.isInteger(position.decimals)) return null;
  const value = (Number(BigInt(position.raw)) / 10 ** position.decimals) * px;
  if (!priced(value)) return null;
  if (!recorded(position.costUsd)) return traded ? { note: NO_RECORD } : null;
  return { label: "Since you bought", text: result(value, position.costUsd) };
}
