// ST-B: an exit plan's words, pure so each line is tested. The steps are from what the person paid (T-5's average cost,
// kept by Trade) when Trade has the buys, else from today's price, and the sheet says which. Never a made-up base.
import type { PriceOrder } from "../orders.ts";
import type { Position } from "../service.ts";
import { price } from "./format.ts";
import { when } from "./order-words.ts";

export const RISE_STEPS = [25, 50, 100] as const;
export const FALL_STEPS = [-10, -20, -30] as const;
/** Hours, with their words. */
export const TIME_STEPS = [[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [72, "3 days"]] as const;
export const PLAN_LINE = "It lasts 7 days.";
export const REPLACES_LINE = (symbol: string) => `This replaces your sell plan for ${symbol}.`;

/** What one unit cost on average, from Trade's record of the buys, or undefined (no record, or not a sane number). */
export function paidPrice(p: Pick<Position, "raw" | "decimals" | "costUsd"> | null | undefined): number | undefined {
  if (!p || !/^\d+$/.test(p.raw) || !Number.isInteger(p.decimals) || BigInt(p.raw) <= 0n) return undefined;
  const c = p.costUsd;
  if (!(typeof c === "number" && Number.isFinite(c) && c >= 0.01 && c < 1e9)) return undefined;
  const units = Number(BigInt(p.raw)) / 10 ** p.decimals;
  const px = c / units;
  return Number.isFinite(px) && px > 0 ? px : undefined;
}
/** The line that says what the steps are from. */
export function baseLine(paid: number | undefined, now: number): string {
  return paid !== undefined ? `From what you paid: ${price(paid)} each.` : `From today's price: ${price(now)}. ZeroFee has no record of your buy.`;
}
/** One exit, as listed: "Sell all if it rises to $0.0031" / "… falls to …" / "Sell all at Tue 6:05 PM". */
export function exitLine(o: Pick<PriceOrder, "kind" | "triggerPx" | "at">): string {
  if (o.kind === "sell-after") return `Sell all at ${when(o.at ?? 0)}`;
  return `Sell all if it ${o.kind === "take-profit" ? "rises" : "falls"} to ${price(o.triggerPx)}`;
}
