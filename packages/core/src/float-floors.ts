// The floors the core holds every Trading move to (float-moves.ts), in one place, so a sheet can say the least that
// arrives from the very figures the core refuses below. No imports: Wallet's Move sheet reads it without the core.
//
// A move in (a row's own coin → Trading's USDC) is refused unless 1Click promises at least (usd − $0.50) / 1.03 (audit
// NF-17: 3 % from the core's own price plus up to $0.50 of fees; 1Click's 1 % slippage fits inside). A move home of
// Trading's USDC is refused unless 1Click promises at least 98 % of it. Hidden's move home (pocket-moves.ts, the same coin
// from the pocket to the Safe) is refused under 98 % too: 1Click charges no fee on a same-coin confidential move (its own
// quote, recorded 25 Oct: 1.000000 USDC in, 1.000000 out, 0.990000 promised), so it usually lands whole, but only 98 % is
// what the core holds it to.

/** A price may be at most 3 % from the core's own. */
export const MAX_OVER = 1.03;
/** Plus up to $0.50 of network fees. */
export const FEE_ROOM_USD = 0.5;
/** A move home of USDC brings at least 98 % of it. */
export const HOME_LEAST_PERCENT = 98n;

/** A Hidden coin's move home brings at least 98 % of it (pocket-moves.ts). */
export const POCKET_HOME_LEAST_PERCENT = 98n;

/** The most USDC a move worth `usd` may cost, and the least it may bring. */
export const mostIn = (usd: number) => usd * MAX_OVER + FEE_ROOM_USD;
export const leastIn = (usd: number) => Math.max(0, (usd - FEE_ROOM_USD) / MAX_OVER);
/** The least a move home of `usd` of Trading's USDC brings to the Safe. */
export const leastHome = (usd: number) => (usd * Number(HOME_LEAST_PERCENT)) / 100;

/**
 * The least one wallet → wallet move can be (E5, security review M1): its move in brings at least leastIn(99 % of it),
 * its move out keeps 3 % for its fee (no trim since D137), and the core refuses a move
 * out under $2. Under this the second leg could stop in the NEAR wallet, so the sheets never offer it: $2.65.
 */
export const PAIR_MIN_USD = Math.ceil(((2 * 1.03) * MAX_OVER + FEE_ROOM_USD) / 0.99 * 100) / 100;   // $2.65 (D137: no trim)
/**
 * The least a Safe → wallet leg can be (UI's AgentZero walk, 3 Nov: a Move passed Face ID, then stopped): the Add brings
 * at least 99 % of it, the move on keeps 3 % for its fee, and the core refuses a move out under $2. Checked before the
 * Approve, so Face ID is never asked for a leg that would stop: $2.09.
 */
export const SAFE_LEG_MIN_USD = Math.ceil(((2 * MAX_OVER) / 0.99) * 100) / 100;
/**
 * The least a wallet → Safe leg can be: its move in brings at least leastIn(99 % of it), and the core refuses a move home
 * under $2 (a $2.00 leg brought about $1.97, and its move home was refused in the NEAR wallet): $2.59.
 */
export const HOME_LEG_MIN_USD = Math.ceil(((2 * MAX_OVER + FEE_ROOM_USD) / 0.99) * 100) / 100;

/**
 * The plan's bound for a leg from the Safe or Private to a wallet, before any quote (the Move page's "Arrives at least",
 * move-split.ts leastOf): the Add brings at least 99 % of it, a leg on to a chain's wallet keeps 3 % for its fee, and
 * each leg pays its chain's fixed network fee (NETWORK_FEE_USD; the audit's MUST, 8 Nov: the bound, not the noise). The Check-this sheet holds leg 2's signed quote to it (the audit's
 * ruling (c), 8 Nov): a quote that promises less, or costs more than the plan's "at most", heads COSTS_MORE.
 */
export const planLeastUsd = (usd: number, chain: WalletChain): number => Math.max(0, (chain === "near" ? usd * 0.99 : (usd * 0.99) / MAX_OVER) - NETWORK_FEE_USD[chain]);
/** A wallet's chain, as the plan and the sheets name them. */
export type WalletChain = "sol" | "hood" | "bsc" | "near";
/**
 * Each leg's fixed network fee on to a wallet's chain (the audit's MUST, 8 Nov: the plan's bound is the percentage part plus
 * it, so a quote that pays it is inside the bound): the ONE table the plan's "at least" / "at most" (planLeastUsd) and the
 * Sim's quotes (MockBridge simSwapCost) read. The NEAR wallet has none (the move lands inside NEAR Intents).
 */
export const NETWORK_FEE_USD: Readonly<Record<WalletChain, number>> = { sol: 0.3, hood: 0.3, bsc: 0.3, near: 0 };
/** A Home name for a wallet ("your SOL wallet") to its chain; null for any other. */
const CHAIN_OF_NAME: Readonly<Record<string, WalletChain>> = { "your SOL wallet": "sol", "your ETH (RH) wallet": "hood", "your BNB wallet": "bsc", "your NEAR wallet": "near" };
export const walletChainOf = (wallet: string): WalletChain | null => CHAIN_OF_NAME[wallet.replace(/^Your /, "your ")] ?? null;
/**
 * The least a wallet's part to another wallet brings, by the core's own floors (move-split.ts leastOf; its move in brings
 * at least leastIn(99 % of it), a move out on to a chain keeps 3 % for its fee): the plan's figure, said "at least about"
 * on a sheet that has no signed quote for it yet (the audit's SHOULD, 8 Nov).
 */
export const walletLegLeastUsd = (usd: number, fromChain: boolean, toChain: boolean): number =>
  fromChain && toChain ? leastIn(usd * 0.99) / MAX_OVER : fromChain ? leastIn(usd * 0.99) : usd * 0.99;
/**
 * The head of a Check-this whose signed quote breaks the plan's bound (the audit's ruling (c); the audit's way-home audit M8, 7 Nov:
 * rule 8, by name, the figure against the plan's, where the money is, the next tap). Three lines, drawn as one card
 * first on the web sheet and the phone's own (apps/ios SheetWords.costsMoreHead reads the same three); the approval sheet
 * re-arms Approve on it (apps/web approval-arm.ts). `fee`: its fees past the plan's "at most"; `least`: it promises less
 * than the plan's "at least". `places`: where the money is now, by Home's names.
 */
export const COSTS_MORE = {
  lead: (by: "fee" | "least", now: string, plan: string) =>
    by === "fee" ? `NEAR Intents takes ${now} in fees now. This Move said at most ${plan}.` : `NEAR Intents moves at least ${now} now. This Move said at least ${plan}.`,
  still: (places: readonly string[]) => `Nothing moved yet. It's still in ${places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places.at(-1)}` : places[0] ?? "your Safe"}.`,
  next: "Tap Approve to go on, or Not now to stop.",
} as const;
const COSTS_LEAD = /^NEAR Intents (takes \$[\d,]+\.\d{2} in fees now\. This Move said at most|moves at least \$[\d,]+\.\d{2} now\. This Move said at least) \$[\d,]+\.\d{2}\.$/;
/** How many of a sheet's first lines are the costs-more head: 3 or 0. */
export function costsMoreHead(lines: readonly string[]): number {
  return lines.length >= 3 && COSTS_LEAD.test(lines[0]!) && lines[1]!.startsWith("Nothing moved yet. It's still in ") && lines[2] === COSTS_MORE.next ? 3 : 0;
}
