// What Buy would refuse, said on the coin page instead of a Buy pill (TRADE-JOURNEYS 21.1 and 21.4): on Solana the mint's own
// answer or the market's freeze flag; on BNB Chain and Robinhood Chain the coin's own sell check, when every recent holder
// tried and none could send it to its pool. A warning (an owner still in control, a check that couldn't run, the market's
// honeypot flag) keeps Buy: the quote's own sell-back simulation still refuses what can't be sold.
import type { EvmSecurity } from "../market/evm-security.ts";
import type { ChainId } from "../types.ts";
import type { BuyRefusal } from "../sol/screen.ts";

export type PageRefusal = BuyRefusal | "unsellable";

export function pageRefusal(chain: ChainId, o: { mint?: BuyRefusal; freezeFlag?: boolean; checks?: EvmSecurity }): PageRefusal | undefined {
  if (chain === "sol") return o.mint ?? (o.freezeFlag ? "freezable" : undefined);
  return o.checks?.cantSell ? "unsellable" : undefined;
}
