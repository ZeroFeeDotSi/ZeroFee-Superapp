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
