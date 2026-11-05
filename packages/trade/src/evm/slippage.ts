// The EVM slippage rule (the old engine's numbers: they differ from Solana's in ../slippage.ts and are kept as they were).
// A deep pool gets a tight limit; a trade that is a real share of the pool, or a route that already loses a lot to impact,
// gets more room. Always inside [100, 1500] bps.
/** How finely an impact from dollar figures (KyberSwap's, or ours from the market price) is known, in bps: a reading of 0
 *  there is an impact under this, the prices' own spread (SPOT_SPREAD's 5 % at most, 3 % here). On chain it is 1 bp. */
export const PRICE_IMPACT_STEP_BPS = 300;

export function slippageBps(a: { liquidityUsd?: number; payUsd: number; impactBps?: number; impactStepBps?: number }): number {
  // the pool's depth as the trade's own impact shows it (x*y=k): a market figure listing it thinner never widens the floor
  // (audit EVM-5, as MKT-2 on Solana: a pool listed at $1 made any trade "a real share" of it, to the ceiling). It can only
  // tighten, so whoever measured the impact (the pool on chain, the aggregator) can at worst cause a revert. No figure:
  // unknown depth, as before
  const i = (a.impactBps ?? 0) / 10_000;
  const implied = i > 0 && i < 1 && a.payUsd > 0 ? (2 * a.payUsd * (1 - i)) / i : 0;
  // an impact measured at 0 is one under its step (`impactStepBps`: 1 on chain, PRICE_IMPACT_STEP_BPS from dollar figures):
  // the pool is at least as deep as that step says, so a listing thinner than that is no figure, as with no listing (fix
  // review RT-6b: with 0 the listing decided alone, and a pool listed at $1 put a $10 trade at the ceiling). Never tighter
  // than an unlisted coin's; an impact not measured (undefined) leaves the listing as before
  const s = (a.impactStepBps ?? PRICE_IMPACT_STEP_BPS) / 10_000;
  const stepDepth = a.impactBps === 0 && a.payUsd > 0 ? (2 * a.payUsd * (1 - s)) / s : 0;
  const liq = a.liquidityUsd === undefined || a.liquidityUsd < stepDepth ? undefined : Math.max(a.liquidityUsd, implied);
  const base = liq === undefined || !(liq > 0) ? 150 : liq >= 1_000_000 ? 100 : liq >= 250_000 ? 150 : liq >= 50_000 ? 300 : 500;
  const share = liq && liq > 0 ? Math.floor((10_000 * a.payUsd * 2) / liq) : 0;   // a trade worth 1 % of the pool adds 2 %
  const impact = (a.impactBps ?? 0) > 100 ? Math.ceil((a.impactBps ?? 0) / 2) : 0;
  return Math.min(1500, Math.max(100, base + share + impact));
}
/** (in - out) / in from dollar figures, in bps; out worth more than in counts as 0, and so does anything unknown. */
export function impactBps(inUsd: string | number | undefined, outUsd: string | number | undefined): number {
  const i = Number(inUsd), o = Number(outUsd);
  if (!(i > 0) || !(o >= 0) || !isFinite(i) || !isFinite(o)) return 0;
  return Math.max(0, Math.round(((i - o) / i) * 10_000));
}
