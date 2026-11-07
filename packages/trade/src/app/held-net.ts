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
