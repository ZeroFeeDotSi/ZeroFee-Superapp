// AgentZero's runner: what AgentZero does when something happens, decided by plain code with no model in the loop and no
// I/O. Each decision is an Action the app hands to the core (the core signs with AgentZero's own key, which release 10
// lets call only `agent_pay`, inside the account contract's daily cap and only to the listed people, budget.ts), or a
// Skip that becomes a receipt saying why nothing moved. `ev.from` is "you" only from a sheet ZeroFee drew and the person
// tapped (the rule box's Pay sheet); a message, a page or the MCP door is never "you" (security design review M3).
//
// Where it runs (D76 amended): on the person's own device, the phone while ZeroFee is open or the laptop's. It is pure
// (events and a ledger in, one action out) so the same code can later run inside a TEE whose attestation the phone checks;
// it never runs as a plain server process, and no ZeroFee server holds AgentZero's key.
//
// Rules that hold whatever an event says:
// - Only the person starts a payment. An order found in a page or a message is refused by name (AZ4).
// - A job never spends past its own day limit, and the day's total never passes its wallet (the contract checks
//   its wallet again; this stops a payment before it is tried).
// - A job that is off does nothing.
import { dayLimit, type Job } from "./jobs.ts";
import { authorises, notAnOrder } from "../guard/guard.ts";

const DAY_MS = 86_400_000;
/** The least AgentZero moves into Spending: under this a top-up mostly goes on fees (the core's FLOAT_MIN_USD). */
export const MIN_TOP_UP_USD = 2;

/** What AgentZero has spent, per job, in the last 24 hours (rolling, like the contract's day). */
export interface Spent {
  atMs: number;
  jobId: string;
  usd: number;
  /** The coin a copy buy bought (per-coin limit). */
  mint?: string;
}

/** A copy job copies one coin at most twice 24 hours, and at most twice in any minute (audit: ten micro-buys by the copied
 *  wallet must not spend the whole day at once). */
export const COPIES_PER_COIN_A_DAY = 2;
export const COPIES_A_MINUTE = 2;

export interface Ledger {
  nowMs: number;
  /** Its wallet one day (the contract's cap), in dollars. 0 when AgentZero is off. */
  pocketUsd: number;
  spent: readonly Spent[];
}

export type Event =
  /** The copied wallet bought a coin (seen on Solana; the fill's latency is not yet measured). */
  | { kind: "leader-buy"; jobId: string; mint: string; symbol: string; signature: string; blockTimeMs?: number }
  /** The copied wallet sold a coin (P4): AgentZero sells all it holds of it. */
  | { kind: "leader-sell"; jobId: string; mint: string; symbol: string; signature: string; blockTimeMs?: number }
  /** A coin AgentZero holds for a copy job is up this much since it bought. */
  | { kind: "gain"; jobId: string; mint: string; symbol: string; pct: number; heldUsd: number }
  /** Spending's balance now, in dollars, and the person's own Spending cap (a top-up never fills past it). */
  | { kind: "spending"; jobId: string; usd: number; capUsd?: number }
  /** Someone asked AgentZero to pay: the person ("you"), or text it read ("page", "message"). */
  | { kind: "pay-ask"; jobId: string; to: string; usd: number; from: "you" | "page" | "message" | "mail" | "memory"; tap?: unknown }
  /** A sign-in step a site window did as AgentZero (D75), for the receipt. */
  | { kind: "site-step"; jobId: string; site: string; line: string };

export type Action =
  | { kind: "buy"; jobId: string; mint: string; symbol: string; usd: number }
  | { kind: "sell"; jobId: string; mint: string; symbol: string; usd: number }
  | { kind: "top-up"; jobId: string; usd: number }
  | { kind: "pay"; jobId: string; to: string; usd: number }
  | { kind: "note"; jobId: string; line: string }
  | { kind: "skip"; jobId: string; line: string };

/** Spent in the rolling day: by this job, and in all. */
export function spentToday(l: Ledger, jobId?: string): number {
  const since = l.nowMs - DAY_MS;
  return l.spent.filter((s) => s.atMs > since && (jobId === undefined || s.jobId === jobId)).reduce((t, s) => t + s.usd, 0);
}

const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number) => Math.floor(n * 100) / 100;

/** How much of `want` this job may spend now: its own day, then its wallet. 0 if none. */
export function room(job: Job, l: Ledger, want: number): number {
  const jobLeft = dayLimit(job) - spentToday(l, job.id);
  const pocketLeft = l.pocketUsd - spentToday(l);
  return Math.max(0, round(Math.min(want, jobLeft, pocketLeft)));
}

/** The one decision. `job` must be the event's job (the caller looks it up by id). */
export function decide(job: Job, ev: Event, l: Ledger): Action {
  const jobId = job.id;
  if (ev.jobId !== jobId) return { kind: "skip", jobId, line: "That wasn't for this job." };
  if (!job.on) return { kind: "skip", jobId, line: "This job is stopped. Nothing moved." };
  // Memory never authorises (the guard, item 11): an order AgentZero read never moves money, whatever the job.
  if (ev.kind === "pay-ask" && !authorises(ev.from)) {
    return { kind: "skip", jobId, line: `Refused. ${notAnOrder(ev.from)} Nothing was sent.` };
  }
  const moves = ev.kind !== "site-step";
  if (moves && l.pocketUsd <= 0) return { kind: "skip", jobId, line: "AgentZero is off. Nothing moved." };

  switch (job.kind) {
    case "copy": {
      if (ev.kind === "leader-buy") {
        const mine = l.spent.filter((s) => s.jobId === jobId && s.atMs > l.nowMs - DAY_MS);
        if (mine.filter((s) => s.mint === ev.mint).length >= COPIES_PER_COIN_A_DAY) return { kind: "skip", jobId, line: `Didn't copy ${ev.symbol}: it was copied twice today.` };
        if (mine.filter((s) => s.atMs > l.nowMs - 60_000).length >= COPIES_A_MINUTE) return { kind: "skip", jobId, line: `Didn't copy ${ev.symbol}: two copies a minute at most.` };
        const usd = room(job, l, job.perTradeUsd);
        if (usd < job.perTradeUsd) return { kind: "skip", jobId, line: `Didn't copy ${ev.symbol}: today's ${money(job.perDayUsd)} is used up.` };
        return { kind: "buy", jobId, mint: ev.mint, symbol: ev.symbol, usd };
      }
      // The copied wallet sold: AgentZero sells all it holds of that coin (usd 0: the whole holding, whatever it's worth).
      if (ev.kind === "leader-sell") return { kind: "sell", jobId, mint: ev.mint, symbol: ev.symbol, usd: 0 };
      if (ev.kind === "gain") {
        if (ev.pct >= job.sellAtPct) return { kind: "sell", jobId, mint: ev.mint, symbol: ev.symbol, usd: round(ev.heldUsd) };
        return { kind: "note", jobId, line: `${ev.symbol} is up ${Math.floor(ev.pct)}%. Sells at +${job.sellAtPct}%.` };
      }
      break;
    }
    case "keep": {
      if (ev.kind === "spending") {
        // Never past the person's own Spending cap (job 2's review): Trade would send the rest home, and AgentZero would top
        // up again, paying fees each round.
        const target = Math.min(job.keepUsd, ev.capUsd !== undefined && ev.capUsd > 0 ? ev.capUsd : Infinity);
        const short = round(target - ev.usd);
        if (short <= 0) return { kind: "note", jobId, line: `Your SOL wallet has ${money(ev.usd)}. Nothing to do.` };
        // Under $2 a top-up would mostly go on fees (the core refuses it, and a refusal would stop the job): wait instead.
        if (short < MIN_TOP_UP_USD) return { kind: "note", jobId, line: `Your SOL wallet is ${money(short)} short. AgentZero tops up ${money(MIN_TOP_UP_USD)} or more.` };
        const usd = room(job, l, short);
        if (usd < MIN_TOP_UP_USD) return { kind: "skip", jobId, line: `Your SOL wallet is ${money(short)} short, but today's ${money(job.perDayUsd)} is used up.` };
        return { kind: "top-up", jobId, usd };
      }
      break;
    }
    case "pay-list": {
      if (ev.kind === "pay-ask") {
        const to = ev.to.trim().toLowerCase();
        if (!job.people.includes(to)) return { kind: "skip", jobId, line: `${to} isn't on your list. AgentZero didn't pay.` };
        if (!(ev.usd > 0)) return { kind: "skip", jobId, line: "There's no amount to pay." };
        const usd = room(job, l, ev.usd);
        if (usd < ev.usd) return { kind: "skip", jobId, line: `${money(ev.usd)} is more than AgentZero has left today. You approve this one.` };
        return { kind: "pay", jobId, to, usd };
      }
      break;
    }
    case "sign-in": {
      if (ev.kind === "site-step") return { kind: "note", jobId, line: ev.line };
      break;
    }
  }
  return { kind: "skip", jobId, line: "This job doesn't do that." };
}

/** What a done action adds to the ledger (only money that moved counts; a sell brings money back, not spent). */
export function spentBy(a: Action, atMs: number): Spent | null {
  if (a.kind === "buy") return { atMs, jobId: a.jobId, usd: a.usd, mint: a.mint };
  if (a.kind === "top-up" || a.kind === "pay") return { atMs, jobId: a.jobId, usd: a.usd };
  return null;
}

/** The ledger kept on the device: only the last 30 days matter. */
export const trimSpent = (spent: readonly Spent[], nowMs: number) => spent.filter((s) => s.atMs > nowMs - 30 * DAY_MS);
