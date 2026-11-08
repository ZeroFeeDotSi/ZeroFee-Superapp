// Audit 12 C7: a wallet Spending lists with coins but no dollar figure (BNB while its chain is closed): Details said "Holds
// 0.08 BNB", while Hot listed no BNB wallet and its total said nothing. Hot now lists it with what it holds, and the line
// under it names what its total leaves out ("BNB wallet not counted. ZeroFee doesn't trade on BNB yet.").
import type { SpendingWallet } from "@zerofee/core/spending";
import { siteWalletFunded } from "@zerofee/core/site-funded";
import { appChain } from "@zerofee/core/app-chains";
import { andList } from "../format.ts";
import type { RowChain } from "./home-view.ts";

// D13 (product decision, 8 Nov): only the app's chains (core app-chains.ts); BNB's wallet is no row and no line in V1
const HOME_CHAINS: readonly string[] = ["sol", "hood", "near", "bsc"].filter(appChain);

/** Its Hot row: the amount where dollars go, never counted (`outside`). Only a current chain wallet that holds coins, on a
 *  Home chain no row has yet. */
export function closedRows(rows: readonly { chain: RowChain }[], wallets: readonly SpendingWallet[] | null | undefined, nameOf: (c: RowChain) => string) {
  return (wallets ?? []).flatMap((w) => {
    const c = String(w.network) as RowChain;
    if (w.role !== "chain" || w.current === false || !HOME_CHAINS.includes(c) || rows.some((r) => r.chain === c)) return [];
    if (!w.holds || !siteWalletFunded(null, w.holds)) return [];
    return [{ chain: c, name: nameOf(c), amount: w.holds, usd: null, coins: [], unpriced: true as const, outside: true as const }];
  });
}

/** What Hot's total leaves out, by each wallet's own name, and why (QA 16: "outside your Trade limit" said no why): the
 *  chain is closed in Trade (Spending's engine has no figure for it, and Trade lists no market on it). */
export const closedLine = (names: string[], chain = "BNB"): string => `${andList(names)} not counted. ZeroFee doesn't trade on ${chain} yet.`;
