// One-balance trading (product decision, 27 Oct 2026): every trade lands in under 2 s, so it is one on-chain swap from money already on
// that chain. The money moved into Trading (one Face ID per refill, Security's sheet) sits in the float, Trade's own NEAR
// Intents account, and is kept spread across the person's own trading wallets (one per chain). Moves between the float
// and those wallets need no sheet (Security, 27 Oct: subwallet.float.out/in) and happen in the background, never in the
// trade path. This is the planner: how much each chain should hold, which background moves bring it there, and how much
// can be bought on a chain right now. Pure: the service runs the moves it returns.
import type { ChainId } from "./types.ts";

export interface FloatState {
  /** What each chain's trading wallet holds in its own coin, in dollars. */
  onChain: Partial<Record<ChainId, number>>;
  /** What the float holds, in dollars (never the main balance: that only moves with Face ID). */
  floatUsd: number;
  /** Background moves the core's fee guard still allows today (none: the guard would ask, so nothing is planned). */
  movesLeft?: number;
}
export interface FloatPolicy {
  /** How the trading money is spread (weights; they need not sum to 1). */
  weights: Partial<Record<ChainId, number>>;
  /** How much in all is kept on chains for trading. */
  budgetUsd: number;
  /** Kept on each chain for its network fees, never offered as buying power. */
  feeReserveUsd: Partial<Record<ChainId, number>>;
  /** A move smaller than this isn't worth its fee (the core refuses under $2). */
  minMoveUsd: number;
}
/** "out": float → the chain's trading wallet (subwallet.float.out); "in": back to the float (subwallet.float.in). */
export type FloatMove = { kind: "out" | "in"; chain: ChainId; usd: number };

export const DEFAULT_POLICY: FloatPolicy = {
  weights: { sol: 1, bsc: 1, hood: 1 },
  budgetUsd: 150,
  feeReserveUsd: { sol: 1, bsc: 0.3, hood: 0.3 },
  minMoveUsd: 5, // above the core fee guard's $2 floor; its 20 moves a day arrive as FloatState.movesLeft
};

/** What each chain should hold: the budget split by weight (fee reserve included), never more than there is in all. */
export function targets(s: FloatState, p: FloatPolicy): Partial<Record<ChainId, number>> {
  const chains = Object.keys(p.weights) as ChainId[];
  const total = chains.reduce((n, c) => n + (p.weights[c] ?? 0), 0);
  const have = chains.reduce((n, c) => n + (s.onChain[c] ?? 0), 0) + s.floatUsd;
  const budget = Math.min(p.budgetUsd, have);
  return Object.fromEntries(chains.map((c) => [c, total > 0 ? (budget * (p.weights[c] ?? 0)) / total : 0]));
}

/** The background moves that bring each chain to its target: moves in first (they free money), then moves out the float can
 *  pay; at most the fee guard's moves left, biggest first. */
export function plan(s: FloatState, p: FloatPolicy): FloatMove[] {
  const t = targets(s, p);
  const moves: FloatMove[] = [];
  let main = s.floatUsd;
  for (const c of Object.keys(t) as ChainId[]) {
    const over = (s.onChain[c] ?? 0) - (t[c] ?? 0);
    if (over >= p.minMoveUsd) { moves.push({ kind: "in", chain: c, usd: round2(over) }); main += over; }
  }
  for (const c of Object.keys(t) as ChainId[]) {
    const short = (t[c] ?? 0) - (s.onChain[c] ?? 0);
    const usd = Math.min(short, main);
    if (usd >= p.minMoveUsd) { moves.push({ kind: "out", chain: c, usd: round2(usd) }); main -= usd; }
  }
  if (s.movesLeft === undefined || moves.length <= s.movesLeft) return moves;
  // too few moves left: the biggest ones (money in before money out, so what's paid out is there)
  const keep = new Set([...moves].sort((a, b) => b.usd - a.usd).slice(0, Math.max(0, s.movesLeft)));
  let free = s.floatUsd;
  return moves.filter((m) => keep.has(m)).filter((m) => (m.kind === "in" ? ((free += m.usd), true) : free >= m.usd && ((free -= m.usd), true)));
}

/** The least a gas top-up asks: over the core's $2 floor with room, since dollars become coin units rounded down and the
 *  core reads them back at its own price ($2.00 came back as $1.999998 and was refused every round: audit AUD-TRD-2). */
export const GAS_TOPUP_MIN_USD = 2.1;
/** What a gas top-up moves to a chain's wallet (float-jobs gasTopUps): at least GAS_TOPUP_MIN_USD, twice its fee reserve. */
export const gasTopUpUsd = (chain: ChainId, reserveUsd: Partial<Record<ChainId, number>>, minUsd = GAS_TOPUP_MIN_USD): number => Math.max(minUsd, (reserveUsd[chain] ?? 0) * 2);
/** How much can be bought on a chain right now (under 2 s): what its trading wallet holds, less its fee reserve. */
export function instantUsd(s: FloatState, p: FloatPolicy, chain: ChainId): number {
  return Math.max(0, round2((s.onChain[chain] ?? 0) - (p.feeReserveUsd[chain] ?? 0)));
}

/** After a trade on a chain, what the background should do: the same plan from the new state (a sale's money flows back to where it's wanted). */
export const afterTrade = (s: FloatState, p: FloatPolicy): FloatMove[] => plan(s, p);

const round2 = (x: number) => Math.floor(x * 100) / 100;

// ---- private mode (TRADE-FLOAT.md §4): no move matches an Add or a sale in amount or time ----

/** A planned move with when it goes: amounts jittered around the need, times spread out. */
export interface TimedMove extends FloatMove {
  at: number;
  /** The wallet it is taken from or sent to, by its id (D55: one current wallet per chain, plus older ones that drain);
   *  none: the chain's current one. */
  wallet?: string;
  /** Why the engine made it, when it isn't the split's own refill or rebalance (Spending's Activity filter, D52). */
  why?: MoveWhy;
  /** The person asked for it (Make ready, Move with sliders): kept through every migration and drop (D102). */
  asked?: true;
  /** The person's one move this is a leg of (a Move's leg on to a chain, or back from one): Activity shows them as one row. */
  of?: string;
}
/** gas: a wallet's network fee; over-cap: cash above Spending's cap going home; older: an older wallet's own coin coming
 *  back to Spending (D55); ready: the person made money ready on a network for Apps. */
export type MoveWhy = "gas" | "over-cap" | "older" | "ready";
export interface PrivacyRules {
  /** Each amount lands within this share either side of what's needed (0.15: ±15 %). */
  jitter: number;
  /** A move waits a random time in this range after it's planned, ms. */
  delayMs: [number, number];
  /** An empty chain's first money waits this instead (FIRST_FUNDING_MS when absent). */
  firstFundingMs?: [number, number];
  /** A two-leg move's second leg (Home's Move and Swap: wallet → Trading → wallet, Safe → Trading → Safe, a take-out's move
   *  home) waits a random time in this range after its first leg landed, ms (LEG_GAP_MS when absent). */
  legGapMs?: [number, number];
}
export const PRIVATE: PrivacyRules = { jitter: 0.15, delayMs: [20_000, 480_000] };
/** ?demo only (the shell's sample wallets, sample data with no chain behind it, so no one to hide from): the same moves and
 *  jitter, seconds apart instead of minutes, so a demo's split lands while someone watches. Never a real account's. */
export const SAMPLE_PACE: PrivacyRules = { jitter: 0.15, delayMs: [2_000, 8_000], firstFundingMs: [1_000, 3_000], legGapMs: [0, 0] };
/**
 * the Home plan §4 (privacy; security review M3): a two-leg move's second leg goes 2 to 15 minutes after its first landed,
 * at random, so the money going into Trading's confidential balance and the money coming out of it don't line up by time
 * (the first leg goes at once: the tap itself is seen by no one). Fixed per move when it is planned, so a restart keeps
 * the same gap. The sheets say "About 10 min." for these moves. The operator may set another range.
 */
export const LEG_GAP_MS: [number, number] = [0, 0];   // D137 (product decision, 3 Nov): no artificial waits; each leg goes the moment the one before lands

/**
 * The next round, private: money back to the reserve goes first, and moves out are paid only from what the reserve
 * holds now (not from money still on its way back). Each amount is jittered and never equal (within 1 %) to an amount
 * the person just added or a sale just paid (`avoid`), so nobody watching both ends can pair them; each move waits a
 * random time. `now` is "the person asked for more on this chain": it goes at once, at the amount asked.
 */
/** An empty chain's first money waits only the short end (Security's floor: never within 20 s of an Add), so the person can
 *  buy there soon after setting up; later moves keep the whole random range. */
export const FIRST_FUNDING_MS: [number, number] = [20_000, 45_000];
/** What a move out takes from the reserve on top of its amount (1Click's fee and the route's, about 2 %): a round keeps
 *  room for it, so its last move is never refused for the fees of the ones before it ("Your trading balance has…"). */
export const OUT_FEE_ROOM = 0.03;
export function nextRound(s: FloatState, p: FloatPolicy, o: { at: number; rng?: () => number; avoid?: number[]; rules?: PrivacyRules; empty?: (chain: FloatMove["chain"]) => boolean }): TimedMove[] {
  const rng = o.rng ?? Math.random, r = o.rules ?? PRIVATE, avoid = o.avoid ?? [];
  let free = s.floatUsd;
  const out: TimedMove[] = [];
  for (const m of plan(s, p)) {
    // in: never more than the excess (the chain keeps its target); out: never more than the reserve holds right now
    const lo = 1 - r.jitter, hi = m.kind === "in" ? 1 : 1 + r.jitter;
    let usd = round2(m.usd * (lo + (hi - lo) * rng()));
    if (m.kind === "out") usd = Math.min(usd, Math.floor((free / (1 + OUT_FEE_ROOM)) * 100) / 100);
    for (const a of avoid) if (Math.abs(usd - a) <= a * 0.01) usd = round2(usd * (1 - 0.02 - 0.03 * rng()));
    if (usd < p.minMoveUsd) continue;
    if (m.kind === "out") free -= usd * (1 + OUT_FEE_ROOM);
    const [lo2, hi2] = m.kind === "out" && o.empty?.(m.chain) ? r.firstFundingMs ?? FIRST_FUNDING_MS : r.delayMs;
    out.push({ ...m, usd, at: o.at + Math.round(lo2 + (hi2 - lo2) * rng()) });
  }
  return out;
}
