// The Sim's sample sites (the Browser's pump.fun and GMGN, SimSite.tsx) on their first tap (Sim pass, 4 Nov: a sample
// coin's Buy said "This wallet has $0.00. Add money to it first."): each site's own Solana wallet starts with sample SOL,
// enough for Buy $20 then Buy $5. Sample money only: the MockBridge's float `held`, never the real core.

/** The sample dollars each site's own Solana wallet starts with. */
export const SIM_SITE_SOL_USD = 25;
/** The sites on the Sim's bar and tray that open a sample site with a Buy. */
export const SIM_SITES = ["pump", "gmgn"] as const;

/** The float's `held`: each site's wallet (`sw-site-<site>-sol`, the id the mock makes it with) and its lamports. */
export function simSiteHeld(solUsd: number, usd = SIM_SITE_SOL_USD): Record<string, string> {
  if (!(solUsd > 0) || !(usd > 0)) return {};
  const lamports = String(Math.round((usd / solUsd) * 1e9));
  return Object.fromEntries(SIM_SITES.map((s) => [`sw-site-${s}-sol`, lamports]));
}
