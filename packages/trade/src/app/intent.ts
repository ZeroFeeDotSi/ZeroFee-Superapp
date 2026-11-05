// What the person is asking for on the Buy / Sell sheet right now: its side and the amount on screen. A prepared quote
// records the intent it was asked for, and only a quote for the intent on screen can be tapped, so a quote prepared for an
// earlier amount is never signed under a newer label ("Buy $10" never spends the $50 quoted a moment before).
import type { ChainId, Side } from "../types.ts";

export const intentOf = (side: Side, value: string): string => `${side}|${value}`;

/** May the pill sign this quote? Only one prepared for the intent on screen, proven, and not already sending. */
export const canTap = (quote: { p?: unknown; for?: string; checked?: boolean }, intent: string, busy: boolean): boolean =>
  !!quote.p && quote.for === intent && !!quote.checked && !busy;

/** A press before the quote is ready (V1: it goes the moment the quote lands) is kept with the intent it was made for, and
 *  goes only for that same intent: change the amount and the kept press is gone, never signed under the new label. */
export const queuedGoes = (queued: string | null, quote: { p?: unknown; for?: string; checked?: boolean }, intent: string, busy: boolean): boolean =>
  queued !== null && queued === intent && canTap(quote, intent, busy);

/** The Buy sheet's one-tap amounts, in dollars. A NEAR coin's smallest is $2: a $1 buy there sits at the core's $1 floor,
 *  so a part of it could never be sold (all of it always can). */
export const buyPresets = (chain: ChainId): string[] => (chain === "near" ? ["2", "25", "50", "100"] : ["1", "25", "50", "100"]);
