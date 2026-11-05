// The shapes Earn's methods answer with (docs/interfaces.md, "Earn"). Amounts are NEAR as decimal strings, times are
// ISO-8601 UTC, rates and fees are percentages as decimal strings.
import type { Problem } from "@zerofee/core/problem";
import type { Wait } from "./epoch.ts";
import type { Fraction } from "./near.ts";
import type { Rate } from "./rate.ts";

export type { Fraction, Rate, Wait };

export interface Validator {
  /** The staking pool's account, e.g. "allnodes.poolv1.near". */
  poolId: string;
  /** "Allnodes". */
  name: string;
  /** Exactly as the pool reports it. Send it back as `feeSeen` when staking. */
  fee: Fraction;
  feePercent: string;
  /** Measured from the pool's own share growth; null when it couldn't be measured. Never shown as a promise. */
  rate: Rate | null;
  /** The validator's whole stake, in NEAR. */
  stake: string;
  /** Share of its due work done this epoch, e.g. "99.8"; null early in an epoch. */
  uptimePercent: string | null;
}

/** NEAR that isn't earning, wherever it sits. */
export interface Idle {
  /** Native NEAR in the account, after its storage and the fee reserve. */
  account: string;
  /** wNEAR held by the account itself (D14). */
  accountWrapped: string;
  /** wNEAR in the NEAR Intents balance (mainnet only; "0" on testnet). */
  ledger: string;
  /** All of the above: the most one stake can take. */
  total: string;
  /** NEAR always left in the account for network fees. */
  reserve: string;
}

export interface Validators {
  /** The one Earn suggests, by its published rules. Null only if no validator passes them right now. */
  picked: Validator | null;
  /** Up to two more, behind "Other validators". */
  others: Validator[];
  idle: Idle;
  wait: Wait;
}

export interface Position {
  poolId: string;
  name: string;
  /** Earning now. */
  staked: string;
  /** Asked back: waiting, or ready to bring home. */
  unstaked: string;
  /** The pool's own answer: the unstaked NEAR can be taken out now. */
  canWithdraw: boolean;
  /** When the unstaked NEAR should be ready, while it waits. */
  readyAtIso?: string;
  /** True when we didn't see the unstake (it happened outside Earn), so `readyAtIso` is the latest it can be. */
  readyIsEstimate?: boolean;
  /** NEAR this stake has earned since Earn saw it go in; absent for NEAR staked outside Earn. */
  earned?: string;
  fee: Fraction;
  feePercent: string;
  rate: Rate | null;
  /** Something the person should know now: the fee went up, or the validator stopped earning. */
  alert?: Problem;
}

/** One thing Earn asked for. Amounts are what was asked; the chain is always the truth for balances. */
export interface HistoryItem {
  atIso: string;
  kind: "stake" | "unstake" | "withdraw";
  poolId: string;
  name: string;
  amount: string;
  /** "on-hold": the account's protection is holding it (D17); it hasn't happened yet. "cancelled": it never ran. */
  status: "done" | "on-hold" | "cancelled";
  /** The held request's id in account.waiting, while it is or was on hold. */
  heldId?: string;
  explorerUrl: string;
  /** For an unstake: when the NEAR should be ready. */
  readyAtIso?: string;
}
