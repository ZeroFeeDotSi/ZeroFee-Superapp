// The Buy sheet's "Move money to your ETH (RH) wallet" (k-trade crawl, 4 Nov, S2): it opened Home's Top up, "Move to your
// NEAR wallet", fixed at the whole Safe with no way to pick an amount, so a first $2 trade couldn't be funded. It opens
// Home's Move instead, from the Safe to the wallet the sheet named, at the buy's dollars; the person moves the slider or
// types another figure, and approves on the core's own sheet as always. Nothing is sent by opening it.
// Under the least one move from the Safe can be (QA's re-test of 95253474: a $1 buy opened Move at $1, its button
// off), it opens at that least instead, marked `raised`, and Home's Move says why in its own words.
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { SPENDING_MIN_MOVE_USD } from "@zerofee/core/spending";
import type { HomeWallet, MoneyAsk } from "@zerofee/shell-api/money.ts";

const WALLETS: readonly HomeWallet[] = ["sol", "hood", "bsc", "near"];

/** The least one move from the Safe to `to` can be, by the core's floors (Home's legMin for a Safe leg). */
const leastTo = (to: HomeWallet): number => (to === "near" ? SPENDING_MIN_MOVE_USD : SAFE_LEG_MIN_USD);

/** Home's Move for a buy on `chain` short of money: that chain's wallet, filled in at `usd` when it is a positive figure,
 *  never under the least a move can be. */
export function fundAsk(chain: string, usd: string): MoneyAsk {
  const to = WALLETS.find((w) => w === chain);
  if (!to) return { kind: "move" };
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return { kind: "move", wallet: to };
  const cents = Math.ceil(n * 100) / 100, least = leastTo(to);
  return { kind: "move", wallet: to, from: "safe", to, usd: String(Math.max(cents, least)), ...(cents < least ? { raised: true as const } : {}) };
}
