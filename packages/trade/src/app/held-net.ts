// T2-4 (the copy review's walk) with the audit's condition (8 Nov): the receipt's holding figure and the market line under a trade's figure.
// The receipt asks one sale quote for exactly the coins held and keeps only its dollar figure: the prepared sale is never
// made ready (no core check of its bytes), never signed, never sent, never booked (no record, so no place in the coin's
// queue), and is dropped here, so its unsigned bytes (and an EVM nonce read into them) go nowhere.
import { cents } from "@zerofee/core/cents";
import type { ChainId, Prepared, Quote } from "../types.ts";
import { heldNetUsd, saleNetUsd } from "../trade-usd.ts";
import { usd } from "./format.ts";

/** What selling all `raw` held gets now, by the Sell sheet's own function; undefined when the quote can't say it. */
export async function heldNetQuote(quote: (side: "sell", chain: ChainId, coin: string, amount: { fraction: 1 }) => Promise<Prepared>, chain: ChainId, coin: string, raw: string): Promise<number | undefined> {
  const p = await quote("sell", chain, coin, { fraction: 1 });
  return heldNetUsd(raw, p.quote);
}

/** The words that go with a holding's one figure, wherever it is shown (the audit's Trade audit T6, 8 Nov). */
export const IF_SOLD = "if sold now";
/** How long a holding's sale figure is kept before it is asked again. */
export const HELD_NET_MS = 20_000;
type QuoteFn = Parameters<typeof heldNetQuote>[0];
const nets = new WeakMap<QuoteFn, Map<string, { at: number; p: Promise<number | undefined> }>>();
const lines = new WeakMap<QuoteFn, Promise<unknown>>();
/** the audit's Trade audit T6 (8 Nov): a holding had two figures, the coin page's and Your coins' coins x market price, and the
 *  receipt's sale net "if sold now". Now every place asks here: one sale figure per chain, coin and amount held, kept
 *  HELD_NET_MS, so the page, the row and the receipt say the same dollars. The asks go one at a time (a list of coins
 *  never bursts the quote doors); a failed one is undefined (no figure shown, never the market price instead). */
export function heldNetOf(quote: QuoteFn, chain: ChainId, coin: string, raw: string, now = Date.now()): Promise<number | undefined> {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) return Promise.resolve(undefined);
  let m = nets.get(quote);
  if (!m) { m = new Map(); nets.set(quote, m); }
  const k = `${chain}:${coin}:${raw}`, hit = m.get(k);
  if (hit && now - hit.at < HELD_NET_MS) return hit.p;
  const p = (lines.get(quote) ?? Promise.resolve()).then(() => heldNetQuote(quote, chain, coin, raw)).catch(() => undefined);
  lines.set(quote, p);
  m.set(k, { at: now, p });
  if (m.size > 64) m.delete(m.keys().next().value!);
  return p;
}

/** the audit's Trade audit T5 (8 Nov): what the receipt says is held, read only once the trade has booked. A sale of all holds
 *  nothing (never "You now hold" the coins just sold); nothing left, nothing said. */
export function heldAfter(soldAll: boolean, p: { raw: string; decimals: number } | undefined): { raw: string; decimals: number } | null {
  if (soldAll || !p || !/^\d+$/.test(p.raw) || BigInt(p.raw) <= 0n) return null;
  return { raw: p.raw, decimals: p.decimals };
}

/** the audit's SHOULD with the copy review's words (8 Nov): one mute line saying how far the quote is from the market price, never called a
 *  fee. The market value is the quote's own (payUsd: each engine prices what is paid at its market or spot price), never a
 *  live or market read, so the sheet's figures all stay the prepared quote's (Security's SHOULD, live-ws.test.ts). A sale:
 *  that value less what the sale gets (the Sell figure), "About $0.07 under the market price."; a buy: what it pays less
 *  its coins' value at that price (getUsd), "About $0.08 over the market price.". No line under a cent, none the other
 *  way. An engine whose quote carries no separate market value (payUsd is the proceeds) shows none. */
export function marketGapLine(side: "buy" | "sell", q: Pick<Quote, "payUsd" | "getUsd" | "feeUsd">): string | null {
  if (!(Number.isFinite(q.payUsd) && q.payUsd > 0)) return null;
  const gap = cents(side === "sell" ? q.payUsd - saleNetUsd(q) : q.payUsd - q.getUsd);
  if (!Number.isFinite(gap) || gap < 0.01) return null;
  return `About ${usd(gap)} ${side === "sell" ? "under" : "over"} the market price.`;
}
