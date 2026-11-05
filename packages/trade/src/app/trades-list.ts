// The coin page's Latest trades (product decision, 28 Oct): each swap that lands goes on top
// as it comes; the list read every 15 s only fills in behind it. One row per transaction, newest first, Whales only the big
// ones, live or read. A Solana socket swap not yet confirmed shows faded, "confirming" (Security, 28 Oct, B): never in Whales,
// replaced by its confirmed copy when the chain settles it, removed when it never does.
export interface TradeRow { t: number; priceUsd: number; side: "buy" | "sell"; usd: number; tx?: string; unconfirmed?: true }
export const SHOWN_TRADES = 20;

export function mergeTrades(landed: readonly TradeRow[], read: readonly TradeRow[] | undefined, minUsd = 0): TradeRow[] {
  const seen = new Set<string>(), out: TradeRow[] = [];
  for (const r of [...landed, ...(read ?? [])]) {
    const k = r.tx ?? `${r.t}:${r.usd}`;
    if (seen.has(k) || r.usd < minUsd || (minUsd > 0 && r.unconfirmed)) continue;
    seen.add(k); out.push(r);
  }
  return out.sort((a, b) => b.t - a.t).slice(0, SHOWN_TRADES);
}

/** The page's landed swaps after one from the feed: its own row at the top (a confirmed copy replaces the "confirming" one). */
export const landedWith = (xs: readonly TradeRow[], t: TradeRow, keep = 50): TradeRow[] => [t, ...xs.filter((x) => x.tx !== t.tx)].slice(0, keep);
/** …and after the chain never confirmed one: it's gone. */
export const landedWithout = (xs: readonly TradeRow[], tx: string): TradeRow[] => xs.filter((x) => x.tx !== tx);

/** A row's side: a swap not final yet is still going through ("Buying", "Selling", faded, its time "now"), never
 *  "Bought … confirming", done and not done in one row (QA's crawl, 5 Nov; the Copywriter). */
export const tradeSide = (t: Pick<TradeRow, "side" | "unconfirmed">): string => (t.unconfirmed ? (t.side === "buy" ? "Buying" : "Selling") : t.side === "buy" ? "Bought" : "Sold");
