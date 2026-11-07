// Test (5 Nov, Sell): the button said "Sell $12.43", the receipt "$12.42" and Activity "$12.43" for one sale; test
// again ($12.43 / $12.42). One function, one figure, for the button, the receipt and Activity: a sale's is what comes
// back, its proceeds less its network fee, at the quote's own price (service.ts books both parts from the same amountOut
// the button was quoted on, at that price), rounded once by the one rule (core cents.ts). A buy's is its coins' part. The
// rounding is display only: the amount sent is the quote's own, never this figure.
import { cents } from "@zerofee/core/cents";
import type { TradeCosts } from "./service.ts";
import type { Quote } from "./types.ts";

/** The one dollar figure of a buy or a sale. A sale: its booked proceeds less its fee once the chain's figure is in, its
 *  quote's before (the button), the record's with neither. A buy: the coins' part once booked, the record's before. */
export const tradeUsd = (r: { kind: string; amountUsd: number; costs?: TradeCosts | undefined; quote?: Pick<Quote, "getUsd" | "feeUsd"> | undefined }): number =>
  r.kind === "sell" ? cents(r.costs ? r.costs.coinUsd - r.costs.feeUsd : r.quote ? r.quote.getUsd - r.quote.feeUsd : r.amountUsd)
    : r.kind === "buy" && r.costs ? r.costs.coinUsd : r.amountUsd;

/** T2-4 (the copy review's walk, 8 Nov: the receipt's "You hold 7,505 DOPE · $24.92" beside the Sell sheet's "$24.85" for the same
 *  coins). Every figure for a holding is what selling it now gets: a sale quote's proceeds less its network fee, the one
 *  rule tradeUsd keeps for a sale. The Sell sheet's figure and the receipt's holding line both read this, from a quote
 *  for exactly those coins; with no such quote, no dollar figure is shown (never the market price times the coins, which
 *  is not what a sale gets: it was the receipt's $24.92, service.ts pricedPositions). */
export const saleNetUsd = (q: Pick<Quote, "getUsd" | "feeUsd">): number => tradeUsd({ kind: "sell", amountUsd: q.getUsd, quote: q });
/** A holding's net figure from a sale quote, only when that quote sells exactly the coins held (`raw`), else undefined. */
export const heldNetUsd = (raw: string, q: Pick<Quote, "side" | "payRaw" | "getUsd" | "feeUsd"> | undefined): number | undefined =>
  q && q.side === "sell" && q.payRaw === raw && BigInt(raw) > 0n && Number.isFinite(q.getUsd) && Number.isFinite(q.feeUsd) ? saleNetUsd(q) : undefined;
