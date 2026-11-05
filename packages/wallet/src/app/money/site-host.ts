// D160 (owner: the Browser's thesis, every site gets its own wallet): Home's site money sheets (Put money in, Take out)
// take any host's own wallet, not only the listed sites'. The Browser opens them from its bar with the host's site id,
// shell.openMoney({ kind: "siteadd" | "siteback", wallet: "host:<host>", name: "<host>" }); the sheets act on wallet ids,
// so the site id is turned into that host's own wallets here, from Spending's own list (spending.wallets). Pure. Loaded
// with the money sheets (SiteMoney.tsx), never in Home's first load.
import type { SpendingWallet } from "@zerofee/core/spending";

/** Is this a site id ("host:<host>" or a listed site's), not a wallet's id? A wallet id is "site-…" (subwallets.ts). */
export const isHostSite = (wallet: string): boolean => wallet.startsWith("host:");

/**
 * The host's own wallets from Spending's list: its Solana wallet (the one Put money in fills and Take out empties) and
 * the others it has on other networks (Take out sweeps them too). Null: the host has no Solana wallet of its own yet
 * (the Browser makes it when the site connects, subwallet.site.forHost). Only current wallets of exactly that site.
 */
export function hostWallets(rows: readonly SpendingWallet[], site: string): { id: string; also: string[] } | null {
  const mine = rows.filter((w) => w.role === "site" && w.site === site && w.current);
  const sol = mine.find((w) => w.network === "sol");
  return sol ? { id: sol.id, also: mine.filter((w) => w !== sol).map((w) => w.id) } : null;
}
