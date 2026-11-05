// Slippage and dollar amounts. Raw amounts are bigint; floats are only for dollars on the screen.

/** Why a quote must not be signed without the person approving it on a sheet (a silent, no-sheet trade refuses it):
 *  `unpriced`: no price independent of the route to hold it to; `high-impact`: its price is far from the market, or its
 *  impact is high; `wide-slippage`: its floor is wider than SILENT_MAX_SLIPPAGE_BPS. */
export type NeedsApproval = "unpriced" | "high-impact" | "wide-slippage";

/** The widest floor a trade may carry without the person approving it on a sheet, in bps (audit finding 2, 4 Nov: a pool
 *  under $15k starts at 15 %, and a session trade signed up to 19 % with no sheet, room enough to sandwich it). */
export const SILENT_MAX_SLIPPAGE_BPS = 500;
/** A buy whose price impact is above this (percent) is never a silent trade. */
export const SILENT_MAX_IMPACT_PCT = 15;
/** Whether a quote needs the person's approval on a sheet, and why: the route's own reason first, then a buy's impact over
 *  SILENT_MAX_IMPACT_PCT, then a floor over SILENT_MAX_SLIPPAGE_BPS. Undefined: it may be a silent trade. */
export function approvalNeeded(q: { side: "buy" | "sell"; slippageBps: number; priceImpactPct?: number; needsApproval?: NeedsApproval }): NeedsApproval | undefined {
  if (q.needsApproval) return q.needsApproval;
  if (q.side === "buy" && (q.priceImpactPct ?? 0) > SILENT_MAX_IMPACT_PCT) return "high-impact";
  if (q.slippageBps > SILENT_MAX_SLIPPAGE_BPS) return "wide-slippage";
  return undefined;
}

/** Dollars -> raw native units (floor). */
export function usdToRaw(usd: number, priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0) || !(usd >= 0)) return 0n;
  const nano = BigInt(Math.floor((usd / priceUsd) * 1e9));
  return (nano * 10n ** BigInt(decimals)) / 1_000_000_000n;
}
export const rawToUsd = (raw: string | bigint, decimals: number, priceUsd: number): number => (Number(BigInt(raw)) / 10 ** decimals) * priceUsd;
export const applyBps = (raw: bigint, bps: number): bigint => (raw * BigInt(10_000 - bps)) / 10_000n;

/** The widest floor Trade gives a Solana trade, in bps: under 20 %, so a trade inside a session keeps room under the core's
 *  rule that a buy's minimum is at least 80 % of what its test run gets (Security 7034ec7, SOL-2). */
export const MAX_SLIPPAGE_BPS = 1_900;

/**
 * Slippage from liquidity: a deep pool gets a tight limit, a thin one a wide one, and the trade's own share of the pool
 * (or the route's measured price impact) adds to it. Always inside [50, MAX_SLIPPAGE_BPS] bps.
 */
export function autoSlippageBps(o: { liquidityUsd?: number; tradeUsd: number; impactPct?: number }): number {
  // the pool's depth as the trade's own impact says it (read on chain: x*y=k, impact = trade / (side reserve + trade)): a
  // market figure that says the pool is thinner than that never widens the floor (audit MKT-2: a pool listed at $1 made a
  // $2.50 trade 250,000 % of it). With no market figure the depth stays unknown, as before: the impact alone can't widen it
  const i = (o.impactPct ?? 0) / 100;
  const implied = i > 0 && i < 1 && o.tradeUsd > 0 ? (2 * o.tradeUsd * (1 - i)) / i : 0;
  const L = o.liquidityUsd === undefined ? undefined : Math.max(o.liquidityUsd, implied);
  const base = L === undefined || !(L > 0) ? 300 : L >= 1_000_000 ? 100 : L >= 250_000 ? 200 : L >= 50_000 ? 400 : L >= 15_000 ? 800 : 1500;
  const shareBps = L && L > 0 ? Math.round((o.tradeUsd / L) * 10_000 * 2.5) : 0;
  const impactBps = Math.round((o.impactPct ?? 0) * 100 * 2);
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(50, base + Math.max(shareBps, impactBps)));
}

/** The most the market data alone (GeckoTerminal through the relay: the day's change, its own recent moves) may widen a
 *  trade's floor, in bps (audit NF-15: one source's "up 400 %, moving 8 % a minute" lifted a $10M pool from 1.5 % to 20 %,
 *  and a session trade signs that with no sheet). What Trade measured itself (its own quotes' moves) widens it only up to
 *  the pool-size default (audit finding 2). */
export const MARKET_WIDEN_MAX_BPS = 400;
/** Room over what Trade measured (the trade's own impact, the coin's own moves), for the moments before it lands. */
export const MEASURED_MARGIN_BPS = 200;

/**
 * Solana's first-try slippage, lifted so a fast coin fills the first time: never under 150 bps in a pool of $5M or more
 * (300 elsewhere), 2.5x how far the coin moved in the last minute or so, and 5% of the day's change in bps (up 40% in a
 * day = 200). `ownMoveBps`: the move Trade measured from its own quotes (widens at most to `baseBps`); `moveBps` and `change24hPct`: the market data's,
 * which together widen it by at most MARKET_WIDEN_MAX_BPS. The automatic re-quote after a revert passes `widen` 1.5.
 * Always inside [50, MAX_SLIPPAGE_BPS].
 */
export function volatileSlippageBps(o: { baseBps: number; liquidityUsd?: number; moveBps?: number; ownMoveBps?: number; change24hPct?: number; widen?: number; impactPct?: number; watched?: boolean }): number {
  const floor = (o.liquidityUsd ?? 0) >= 5_000_000 ? 150 : 300;
  const fromMarket = Math.min(MARKET_WIDEN_MAX_BPS, Math.max(Math.round((o.moveBps ?? 0) * 2.5), Math.round(Math.abs(o.change24hPct ?? 0) * 100 * 0.05)));
  const fromOwn = Math.round((o.ownMoveBps ?? 0) * 2.5);
  // audit MKT-2: the liquidity tiers aren't a measurement. Once Trade has watched the coin (`watched`: its own quotes over
  // 20 s or more), the base is no wider than what it measured: the trade's own impact and the coin's own moves, with
  // MEASURED_MARGIN_BPS of room. A coin not watched yet keeps the tiers, so its first quote still fills.
  const measured = Math.max(floor, fromOwn, Math.round((o.impactPct ?? 0) * 100 * 2.5)) + MEASURED_MARGIN_BPS;
  const base = o.watched ? Math.min(o.baseBps, measured) : o.baseBps;
  // audit finding 2 (4 Nov): the coin's own moves are 90 s of quotes anyone can drive by trading the pool; they may narrow
  // the floor (above) but never widen it past the pool-size default, so moving a thin pool can't open room to sandwich the next buy
  const ownRoom = Math.min(fromOwn, o.baseBps);
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(50, Math.round(Math.max(base, floor, fromMarket, ownRoom) * (o.widen ?? 1))));
}

/** How far a coin moved lately, from our own quotes of it: the range of its price over the last 90 s, in bps. */
/** How long Trade's own quotes of a coin must span before what it measured stands in for the liquidity tiers (MKT-2). */
export const WATCHED_MS = 20_000;
export class MoveSamples {
  private samples = new Map<string, { t: number; p: number }[]>();
  note(mint: string, t: number, p: number): void {
    if (!(p > 0) || !Number.isFinite(p)) return;
    const list = (this.samples.get(mint) ?? []).filter((x) => t - x.t < 90_000);
    list.push({ t, p });
    this.samples.set(mint, list);
  }
  /** The newest of Trade's own prices of this coin in the last 90 s (its quotes' coins per SOL), or undefined. */
  last(mint: string, t: number): number | undefined {
    const v = (this.samples.get(mint) ?? []).filter((x) => t - x.t < 90_000);
    return v.length ? v[v.length - 1]!.p : undefined;
  }
  /** Trade has watched this coin: its own quotes span at least WATCHED_MS (what it measured can stand in for the tiers). */
  watched(mint: string, t: number): boolean {
    const v = (this.samples.get(mint) ?? []).filter((x) => t - x.t < 90_000);
    return v.length >= 3 && v[v.length - 1]!.t - v[0]!.t >= WATCHED_MS;
  }
  bps(mint: string, t: number): number {
    const v = (this.samples.get(mint) ?? []).filter((x) => t - x.t < 90_000).map((x) => x.p);
    if (v.length < 2) return 0;
    return Math.round(((Math.max(...v) - Math.min(...v)) / Math.min(...v)) * 10_000);
  }
}
