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
