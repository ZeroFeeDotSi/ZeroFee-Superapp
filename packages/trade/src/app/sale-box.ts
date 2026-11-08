// The Sell page's amount box before (or without) its quote (QA 16 on the S6 shot, 8 Nov: an empty grey block, no figure,
// while a sale short of its fee could not be quoted). It says what the sale is worth from the holding the moment the page
// opens: the quote's own figure once it answers; until then "About $24.85" (the market price times the share, marked
// About, since a sale gets a little less); the coin count when the coin has no price; the shimmer only while the holding
// itself is unread.
import { amount, usd } from "./format.ts";

export interface SaleBox { figure: string; about: boolean }

export function saleBox(o: { quotedUsd?: number; pos?: { raw: string; decimals: number; valueUsd?: number } | null; share: number; symbol: string }): SaleBox | null {
  if (o.quotedUsd !== undefined) return { figure: usd(o.quotedUsd), about: false };
  const p = o.pos;
  if (!p || !/^\d+$/.test(p.raw) || BigInt(p.raw) <= 0n) return null;
  const share = Math.min(1, Math.max(0, o.share));
  if (p.valueUsd !== undefined && Number.isFinite(p.valueUsd) && p.valueUsd > 0) return { figure: usd(p.valueUsd * share), about: true };
  return { figure: `${amount((BigInt(p.raw) * BigInt(Math.round(share * 1e6))) / 1_000_000n, p.decimals)} ${o.symbol}`, about: false };
}
