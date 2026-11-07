// What the one-balance screens read and do (TRADE-FLOAT.md §1): the Trading total, the reserve, each chain's wallets
// and what's ready to buy with, the fixed split, and the background moves in words. The screens build on this
// interface only; behind it sits either the sample below (?demo, and the screens' tests) or, once Security's float
// methods land, the core-backed one. Moving a slider changes targets only: money moves later, in the background.
import type { MoveProof } from "@zerofee/core/tx-proof";
import { DEFAULT_POLICY, instantUsd, plan, type FloatPolicy, type MoveWhy } from "./float.ts";
import type { ChainId } from "./types.ts";
import { ProblemError } from "@zerofee/core/problem";
import { tradeProblems } from "./trade-problems.ts";

export type FloatChain = Extract<ChainId, "sol" | "hood" | "bsc">;
export const FLOAT_CHAINS: readonly FloatChain[] = ["sol", "hood", "bsc"];
/**
 * H04 / H31 (D13): BNB Chain's route in and out isn't proven with real money (the core refuses every BNB move,
 * packages/core/src/float-moves.ts CHAIN_COIN.bsc.open), so until it is, BNB is not offered anywhere: not in the
 * totals, Take out, Receive, Discover or the pickers, and no way in (no one-way door). A BNB wallet that already holds
 * money is still listed in Trading wallets, said plainly. Turn on only with the core's own gate, after its dust test.
 */
export const BNB_PROVEN = false;
/** A chain Trade offers today. */
export const proven = (c: string): boolean => c !== "bsc" || BNB_PROVEN;
const NAME: Record<FloatChain, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };

/** Each chain's share and the reserve's, whole percents that sum to 100: Spending's own, the same for everyone (D52). */
export interface Split { sol: number; hood: number; bsc: number; reserve: number }
export const DEFAULT_SPLIT: Split = { sol: 40, hood: 25, bsc: 25, reserve: 10 };
/**
 * The starter split: each network's share of what Spending spreads, by how often the person traded there lately. A
 * network keeps a third of its default share however little it's used (its first trade is still instant); the other
 * two thirds follow the trades. No trades yet: the default. Whole percents, the reserve's share unchanged.
 */
export function splitFromUse(base: Split, trades: Partial<Record<FloatChain, number>>): Split {
  const n = FLOAT_CHAINS.reduce((k, c) => k + (trades[c] ?? 0), 0);
  if (!n) return { ...base };
  const pot = 100 - base.reserve;
  const share = Object.fromEntries(FLOAT_CHAINS.map((c) => [c, Math.floor(base[c] / 3 + (pot - pot / 3) * ((trades[c] ?? 0) / n))])) as Record<FloatChain, number>;
  const top = FLOAT_CHAINS.reduce((a, c) => (share[c] > share[a] ? c : a));
  share[top] += pot - FLOAT_CHAINS.reduce((k, c) => k + share[c], 0);
  return { ...share, reserve: base.reserve };
}
/** Under this, a chain's share is "too little to move" (V1's per-leg minimums). */
export const CHAIN_MIN_USD: Record<FloatChain, number> = { sol: 5, hood: 5, bsc: 10 };

/** `movableUsd`: what of its own coin can go back (the core keeps the chain's fee room; ?demo's opening money can't move). */
/** `oldWords`: it opens with the backup words the person has replaced (it still works; its money can go to your balance). */
/** `current`: the chain's one wallet (D55); false: an older one, listed while it holds anything, its own coin coming back. */
export interface WalletView { id: string; chain: FloatChain; address?: string; nativeUsd: number; movableUsd?: number; coinsUsd: number; current: boolean; oldWords?: true; keyExported?: true }
export interface ChainView {
  chain: FloatChain; name: string;
  /** In the chain's wallets as its own coin, and what of that a buy can use at once (less the fee reserve). */
  nativeUsd: number; readyUsd: number; coinsUsd: number;
  /** The chain's own coin as the chain has it ("1.42"), every wallet on it summed (Home V4's row); absent when unread. */
  nativeAmount?: string;
  targetUsd: number; pct: number;
  /** Its share is set but too small to move. */
  tooLittle: boolean;
  inFlight?: { usd: number; etaSec: number; to: "chain" | "reserve" };
  /** The core doesn't move money to this chain yet (BNB Chain until its own test): its share goes to the others. */
  closed?: true;
  /** A wallet on it has no figure (its read failed, none before it): its dollars are unread, never $0. */
  unread?: true;
  wallets: WalletView[];
}
export type MoveKind = "add" | "out" | "in" | "home";
export type MoveStatus = "waiting" | "moving" | "done" | "failed" | "refunded";
/** `held`: an Add the account's protection holds (D17): it waits in the main balance, and the shell's Waiting screen shows it. */
export interface MoveRow { id: string; kind: MoveKind; chain?: FloatChain; usd: number; /** the person's own figure at the tap, kept when `usd` is priced again (float-jobs Job.askedUsd) */ askedUsd?: number; status: MoveStatus; where: "main" | "reserve" | "chain" | "in-flight"; at: number; etaSec?: number; held?: { id: string; readyAtIso: string; needsSecondDevice: boolean };
  /** A failed move that never left: refused before anything moved, so nothing is coming back. */
  stayed?: true;
  /** A Top up's 1Click deposit address, as the Safe paid it: the core's own record of the Add, by this (finding 18). */
  deposit?: string;
  /** Why the engine made it (Spending's Activity filter, D52); "asked": the person's own (an Add, a Take out). */
  why?: MoveWhy | "asked";
  /** Why it stopped and where its money is, in words. */
  note?: string;
  /** S21: a move home 1Click says is done that the Safe's read hasn't shown yet: on its way, `note` says so, no clock. */
  unshown?: true;
  /** A step the phone signs, waiting while ZeroFee is off screen: it finishes next time the app opens. */
  paused?: true;
  /** An Add for a site's own wallet (Social Trading's Add): once it is in Spending it goes on to that wallet, by its id;
   *  `name`, the site's ("pump.fun"), for its row; `sent` once that move was asked; `failed`, why it didn't go on. */
  ready?: { wallet: string; name: string; /** its site ("pump", or D160 a host's own "host:<host>") */ site?: string; sent?: true; failed?: string; landedAt?: number; /** leg 2 (F1) */ job?: string };
  /** Move (FLOW-V4 §1): where the person split this Add, each leg going on to that chain's own wallet once it is in
   *  Spending, the moment it lands (D137: no gap, no trim). A NEAR leg stays in Spending's own balance. */
  legs?: { chain: FloatChain; usd: number; sent?: true; failed?: string; sendingAt?: number; short?: number }[];
  /** Older builds only: the inflow grid's rest sent back to the Safe. Never planned now (privacy audit, 4 Nov: the rest
   *  stays hidden in the NEAR wallet); kept so a saved row still reads. */
  restHome?: { usd: number; sent?: true; after?: number };
  /** When the Add's money was first seen in Spending. */
  legsLandedAt?: number;
  /** What the Add brought, less what its legs took (review L2): its legs never take Trading's other cash. */
  legsLeft?: number;
  /** A move to one wallet by its id (a site's own wallet, a sale's fee). */
  wallet?: string;
  /** The person's one move this is a leg of (a Move's leg on to a chain, or back from one): Activity shows them as one row. */
  of?: string;
  /** E5: a wallet → wallet move's first leg, and where the money goes on to ("near": it stays in Trading's cash). */
  to?: FloatChain | "near";
  /** E7: an Add that is a swap inside the Safe: once in Trading it goes home at once (D137), by its own key. */
  home?: { sent?: true; failed?: string; landedAt?: number; gap?: number; job?: string; over?: true; show?: Pick<MoveRow, "status" | "where" | "note"> };
  /** E7: the Safe's coin it was paid with ("NEAR"). */
  paidWith?: string;
  /** Its proof (product decision, 3 Nov; tx-proof.ts): the transactions that set it off and landed it, as the core gave them. */
  proof?: MoveProof;
  /** An Add saved before the Safe's signature (bug report, 5 Nov): its job's key, when it was
   *  saved, and once a page closed while it was asked (`orphan`), what the chain and 1Click said of it since. */
  signing?: { at: number; job: string; orphan?: true; checkedAt?: number; late?: true; tokenId?: string };
  /** The ledger's own id for the Add (its movement), once it answered: the row keeps its job's id from the start. */
  mv?: string;
  /** Paid from Private (float-private.ts, NEAR Confidential): each leg one payment to its wallet, by the ledger's
   *  movements (a "safe-send:" one fills Private from the Safe first); `ends`, each movement's end once heard. */
  priv?: { parts: { wallet: string; chain: FloatChain | "near"; usd: number; ids: string[]; ends?: Record<string, string>; stopped?: string;
    /** It stopped with its money unknown (the ledger's private-move.ts): no Try again on its row, only Activity. */
    unsure?: true;
    /** Each unpaid payment's money state, as its Problem said it (send-job.ts: "on-the-way" while leg 1 hasn't arrived):
     *  its words say on its way to Private, never back in Private (audit, 6 Nov). */
    money?: Record<string, string>;
    /** the audit (5 Nov): the wallet's own coin before it was paid (its native units, read at the tap) and the least the payout's
     *  quote promises (its minAmountOut: the quoted out less slippage): Done only when a read shows the balance up by at
     *  least `minOut` over `base` (float-private chainShown). */
    base?: string; minOut?: string }[]; checkedAt?: number; fill?: "doing" | "done";
    /** Every payment ended and some arrived (the ledger's word): the row is Done only once a balance read begun after
     *  `at` shows it (float-core arrivedRead; rule 11), with `note` then. */
    landed?: { at: number; note?: string; misses?: number } };
}
/** totalUsd: everything in Trading, the coins held included (the same figure as Positions and Wallet's "In trading"). */
/** takeableUsd: what Take out can bring home now (the reserve and what the core can move on the chains; never coins held). */
/** loaded: the float has answered (before that, say it's getting ready, never "empty"). unread: it was asked and has no
 *  figure to give (a restore with 1Click not answering, audit F-1): say "can't be read right now", never $0 or "empty". */

export interface FloatSnapshot { loaded?: boolean; unread?: true; takeableUsd: number; totalUsd: number; reserveUsd: number; chains: ChainView[]; split: Split; moves: MoveRow[]; movesLeftToday: number }

export interface FloatView {
  snapshot(): FloatSnapshot;
  subscribe(fn: () => void): () => void;
  /** A Move and a site's Add pay from Private (NEAR Confidential), never the Safe's public leg (float-core `fromPrivate`). */
  readonly fromPrivate?: boolean;
  /** Main balance → Trading (Security's refill sheet: one Face ID). `from`: paid with another main-balance coin than USDC
   *  (that much of it, converted to USDC inside the Add, Security fd3620a); `usd` is then what it's worth. */
  /** Move's take-out: from the rows picked, each an amount or "all", back to the Safe. */
  takeOutFrom?(legs: { chain: FloatChain | "near"; usd: number | "all" }[]): Promise<MoveRow>;
  /** `asker` (D146): the app that asked Spending for it, passed on to the ledger so the Safe's sheet names that app. */
  add(usd: number, from?: { tokenId: string; amount: string; symbol: string }, ready?: { wallet: string; name: string; site?: string }, legs?: { chain: FloatChain; usd: number }[], then?: { home?: true; swap?: { pay: string; get: string } }, asker?: string, job?: string): Promise<MoveRow | "declined">;
  /** Trading → main balance; the chains come back to the reserve first. */
  takeOut(usd: number | "all", o?: { parked: true }): Promise<MoveRow>;
  /** The person asked for more on a chain now: one move at once, no random wait. `wallet`: to that wallet, by id (a sale's
   *  own fee, to the wallet holding the coin); none: the chain's current one. `why` "ready": Spending made it ready for Apps. */
  moveNow(chain: FloatChain, usd: number, o?: { wallet?: string; why?: MoveWhy }): Promise<MoveRow>;
  /** A Buy sheet is open on this chain: the planner pulls nothing back from it until the returned release is called. */
  keep(chain: FloatChain): () => void;
}

/** The planner's policy from the split: the chains' weights, and what the reserve leaves for them. */
export function policyOf(split: Split, totalUsd: number, base: FloatPolicy = DEFAULT_POLICY): FloatPolicy {
  return { ...base, weights: { sol: split.sol, hood: split.hood, bsc: split.bsc }, budgetUsd: (totalUsd * (100 - split.reserve)) / 100 };
}

/** A move in words: move-words.ts (Trade's own screens load it). */
/** What a float the core couldn't read says (audit F-1): never $0, never "empty". */
/** A row paid from Private holding a part whose money is on its way to Private (float-private partEnd's hold): read
 *  again, ended or not, until the ledger says the money is there (audit, 6 Nov: the hold had no end). Pure: a table test. */
export const heldRow = (r: Pick<MoveRow, "priv">): boolean => (r.priv?.parts ?? []).some((p) => p.ids.some((id) => p.money?.[id] === "on-the-way"));
export const UNREAD_WORDS = "Your NEAR wallet didn't load right now";

// ---- the sample: ?demo and the screens' tests. No network, no keys; time is injected. ----

export interface SampleOpts {
  now?: () => number;
  /** Runs `fn` after `ms` (tests pass a scheduler they step by hand). */
  later?: (fn: () => void, ms: number) => void;
  /** Main balance → Trading's answer (the refill sheet); default yes. */
  approve?: (usd: number) => Promise<boolean>;
  /** Seconds a move takes in the sample (measured live moves take about a minute; the sample is quicker). */
  moveSec?: number;
}

export function createSampleFloat(o: SampleOpts = {}): FloatView {
  const now = o.now ?? Date.now, later = o.later ?? ((fn, ms) => { setTimeout(fn, ms); }), moveSec = o.moveSec ?? 6;
  const split: Split = { ...DEFAULT_SPLIT };
  let reserve = 0, n = 0, movesLeft = 20, leaving = false;
  const native: Record<FloatChain, number> = { sol: 0, hood: 0, bsc: 0 };
  const moves: MoveRow[] = [];
  const subs = new Set<() => void>();
  const tell = () => { for (const f of subs) f(); };
  const total = () => reserve + FLOAT_CHAINS.reduce((s, c) => s + native[c], 0) + moves.filter((m) => m.where === "in-flight" && m.kind !== "home").reduce((s, m) => s + m.usd, 0);
  const row = (kind: MoveKind, usd: number, chain?: FloatChain): MoveRow => { const m: MoveRow = { id: `mv${++n}`, kind, usd: round2(usd), status: "moving", where: "in-flight", at: now(), etaSec: moveSec, ...(chain ? { chain } : {}) }; moves.unshift(m); return m; };
  const finish = (m: MoveRow, land: () => void, where: MoveRow["where"]) => later(() => { land(); Object.assign(m, { status: "done", where, etaSec: undefined }); rebalance(); tell(); }, moveSec * 1000);

  function out(chain: FloatChain, usd: number): MoveRow {
    reserve -= usd; movesLeft--;
    const m = row("out", usd, chain);
    finish(m, () => { native[chain] += m.usd; }, "chain");
    return m;
  }
  function back(chain: FloatChain, usd: number): MoveRow {
    native[chain] -= usd; movesLeft--;
    const m = row("in", usd, chain);
    finish(m, () => { reserve += m.usd; }, "reserve");
    return m;
  }
  function rebalance() {
    if (leaving) return;                                                                  // taking out: nothing goes back to the chains
    if (moves.some((m) => m.status === "moving" && (m.kind === "out" || m.kind === "in"))) return;   // one round at a time
    for (const mv of plan({ onChain: { ...native }, floatUsd: reserve, movesLeft }, policyOf(split, total()))) {
      if (mv.kind === "out") out(mv.chain as FloatChain, mv.usd); else back(mv.chain as FloatChain, mv.usd);
    }
  }

  return {
    snapshot() {
      const t = total(), p = policyOf(split, t), budget = p.budgetUsd, weights = split.sol + split.hood + split.bsc;
      const chains = FLOAT_CHAINS.map((c): ChainView => {
        const targetUsd = weights > 0 ? round2((budget * split[c]) / weights) : 0;
        const fly = moves.find((m) => m.status === "moving" && m.chain === c && (m.kind === "out" || m.kind === "in"));
        return {
          chain: c, name: NAME[c], nativeUsd: round2(native[c]), readyUsd: instantUsd({ onChain: native, floatUsd: reserve }, p, c), coinsUsd: 0,
          targetUsd, pct: split[c], tooLittle: split[c] > 0 && targetUsd < CHAIN_MIN_USD[c],
          ...(fly ? { inFlight: { usd: fly.usd, etaSec: Math.max(0, Math.ceil(moveSec - (now() - fly.at) / 1000)), to: fly.kind === "out" ? "chain" as const : "reserve" as const } } : {}),
          wallets: [{ id: `sample-${c}`, chain: c, nativeUsd: round2(native[c]), movableUsd: round2(native[c]), coinsUsd: 0, current: true }],
        };
      });
      return { loaded: true, takeableUsd: round2(reserve + FLOAT_CHAINS.reduce((n, c) => n + native[c], 0)), totalUsd: round2(t), reserveUsd: round2(reserve), chains, split: { ...split }, moves: moves.map((m) => ({ ...m })), movesLeftToday: movesLeft };
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    async add(usd) {
      if (!(await (o.approve ?? (async () => true))(usd))) return "declined";
      const m = row("add", usd);
      finish(m, () => { reserve += m.usd; }, "reserve");
      tell();
      return m;
    },
    async takeOut(usd) {
      leaving = true;
      for (const c of FLOAT_CHAINS) if (native[c] > 0) back(c, native[c]);
      const m = row("home", usd === "all" ? total() : Math.min(usd, total()));
      // after the chains' money is back in the reserve (one move's time), the reserve goes home
      later(() => { m.usd = round2(usd === "all" ? reserve : Math.min(m.usd, reserve)); reserve -= m.usd; leaving = false; Object.assign(m, { status: "done", where: "main", etaSec: undefined }); tell(); }, moveSec * 2000);
      tell();
      return m;
    },
    async moveNow(chain, usd) { const m = out(chain, Math.min(usd, reserve)); tell(); return m; },
    keep() { return () => undefined; },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
