// What a buy can really spend from a chain's wallet (webd-money2 crawl, 4 Nov: "From your SOL wallet · $0.14 to spend" on
// $1.15, yet a $0.50 buy went through). The sheet said the planner's flat $1 Solana fee reserve (float.ts DEFAULT_POLICY),
// which the trade never keeps; the Solana engine keeps only what this buy and the later sell need (sol/context.ts payOf:
// two fee reserves, the new coin account's rent, the temporary wSOL account's rent). Said here as that same figure.
// BNB and Robinhood keep their policy reserve, as their engines do.
import type { ChainView } from "../float-view.ts";

/** payOf's own keep on Solana, in lamports (a Token-2022 coin account, the larger rent): 2 × (BASE_FEE + PRIO_RESERVE) +
 *  TOKEN22_RENT + TOKEN_RENT (the wSOL account). sol/context.ts is not imported, so this stays out of Home's first load. */
export const SOL_BUY_KEEP_LAMPORTS = 2 * (5_000 + 25_000) + 1_513_840 + 1_488_440;

/** Dollars a buy can spend now: Solana, the wallet less payOf's keep at the wallet's own price; else the chain's ready figure. */
export function buyRoomUsd(c: Pick<ChainView, "chain" | "nativeUsd" | "readyUsd" | "nativeAmount">): number {
  const sol = Number(c.nativeAmount);
  if (c.chain !== "sol" || !(sol > 0) || !(c.nativeUsd > 0)) return c.readyUsd;
  const keepUsd = (SOL_BUY_KEEP_LAMPORTS / 1e9) * (c.nativeUsd / sol);
  return Math.max(0, Math.floor((c.nativeUsd - keepUsd) * 100) / 100);
}
