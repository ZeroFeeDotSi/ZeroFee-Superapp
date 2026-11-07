// Settings > Sites' site wallets (bug report, 5 Nov: Settings said "You haven't connected any sites" over two funded site
// wallets), pure so node tests it (site-one-figure.test.ts); SiteRows.tsx draws them.
import type { SpendingWallet } from "@zerofee/core/spending";

/** A site's own wallet as Settings lists it: the wallet's name and its one figure (spending.wallets, Home's figure). */
export interface SiteWalletLine { id: string; title: string; line: string }
const CHAIN_NAMES: Readonly<Record<string, string>> = { sol: "Solana", bsc: "BNB Chain", base: "Base", eth: "Ethereum" };

/** Each current site wallet, AgentZero's pocket aside: "<site> · $X" (the copy review's spec, a Sim walk, 5 Nov), its
 *  network under it; an unread one says so in the dollars' place. */
export function siteWalletLines(list: readonly SpendingWallet[]): SiteWalletLine[] {
  return list.filter((w) => w.role === "site" && w.current && w.site && w.site !== "agentzero").map((w) => {
    const usd = w.unread || w.cashUsd === undefined ? null : Number(w.cashUsd) + (Number(w.coinsUsd) || 0);
    // an empty wallet is "$0.00" as every other empty row, never "0 ETH" (a Base wallet with no price: the proof, 5 Nov)
    const none = !w.unread && /^0(\.0+)?(\s|$)/.test(w.holds ?? "");
    const figure = usd === null || !Number.isFinite(usd) ? (none ? "$0.00" : w.holds ?? "Can't see it now") : `$${usd.toFixed(2)}`;
    return { id: w.id, title: `${w.label.replace(/ wallet$/, "")}${figure.startsWith("$") ? " " : " · "}${figure}`, line: CHAIN_NAMES[w.network] ?? w.network };
  });
}
