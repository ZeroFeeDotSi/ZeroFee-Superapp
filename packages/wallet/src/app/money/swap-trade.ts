// A trade's job behind Home's Swap (CoinSwap.tsx): its ask, its steps in the "they" voice (the exchange named), and the
// run that ends it on the chain's own answer, with its proof: on Home's Jobs row and on the sheet's tracker. Pure but for
// the bridge and the task store it is handed.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { tradePaid } from "@zerofee/core/zero-fee";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { tradeStep, tradeStepDone } from "./swap-coins.ts";
import type { LiveTrack } from "./live-steps.ts";

/** spending.swap.quote's answer (trade/src/swap-door.ts SwapQuoteView). */
export interface CoinQuote { id: string; chain: "sol" | "hood"; legs: { side: "buy" | "sell"; route: string; symbol: string }[]; payUsd: number; getRaw: string; getMinRaw: string; getDecimals: number; getSymbol: string; getUsd: number; about: boolean; feeUsd: number }
/** spending.swap.go's answer. `stopped`: a sale landed and its buy didn't go (the price moved, or the buy was refused). */
export interface CoinDone { legs: { id: string; side: "buy" | "sell"; status: string; hashes: string[]; landedMs?: number }[]; stopped?: { code: string; whatHappened: string } }

export const NATIVE_SYMBOL = { sol: "SOL", hood: "ETH" } as const;
const WALLET = { sol: "your SOL wallet", hood: "your Robinhood wallet" } as const;
/** The exchanges a quote's legs trade on, each once: "Jupiter", "PumpSwap and Jupiter". */
export const exchanges = (q: Pick<CoinQuote, "legs">): string => q.legs.map((l) => l.route).filter((x, i, a) => x && a.indexOf(x) === i).join(" and ") || "The exchange";
/** No quote in time: who didn't answer, when known. */
export const priceLate = (q: Pick<CoinQuote, "legs"> | null): string => `${q ? exchanges(q) : "The exchange"} didn't answer.`;
/** A trade that didn't finish: whose step, and what the person holds now (a coin → coin whose sale landed: the chain's coin). */
export function notSwapped(q: CoinQuote, legs: CoinDone["legs"]): string {
  const sold = q.legs.length > 1 && legs[0]?.status === "done";
  const who = (sold ? q.legs[1]!.route : q.legs[0]!.route) || "The exchange";
  return sold ? `${who} didn't swap. You have ${NATIVE_SYMBOL[q.chain]} now.` : `${who} didn't swap. Your coins are in your wallet.`;
}
/** Landed: where it is now ("In your SOL wallet as DOPE."). */
export const landedLine = (q: CoinQuote, getLabel: string): string => (getLabel === NATIVE_SYMBOL[q.chain] ? `It's in ${WALLET[q.chain]}.` : `${getLabel} is in ${WALLET[q.chain]}.`);
/** Sent, and the chain hasn't said yet (QA's SHOULD: never "failed" before the chain says so). */
const CHAIN_NAME = { sol: "Solana", hood: "Robinhood Chain" } as const;
export const checkingLine = (q: CoinQuote, legs = 1): string => (q.legs.length > 1 && legs < 2 ? `${CHAIN_NAME[q.chain]} hasn't confirmed the sale yet. Nothing was bought.` : `${CHAIN_NAME[q.chain]} hasn't confirmed it yet.`);
/** Under the button (product decision, 5 Nov: we are zero fee): who gets the fee, the exchange's in its price and the network's own
 *  figure from the quote ("Jupiter's fee is in the price. Solana's network gets about $0.01. ZeroFee takes nothing."). */
export const paidLine = (q: CoinQuote): string => tradePaid(exchanges(q) === "The exchange" ? null : exchanges(q), CHAIN_NAME[q.chain], q.feeUsd);
const CHAIN_OF_PROOF ={ sol: "sol", hood: "hood" } as const;

/** The trade's ask: dollars, or all of the coin (Max). */
export const coinAsk = (chain: "sol" | "hood", pay: string, get: string, usd: number, all: boolean): Record<string, unknown> => ({ chain, pay, get, ...(all ? { all: true } : { usd: Number(usd.toFixed(2)) }) });

export type TradeStepState = "waiting" | "doing" | "done" | "failed";
export interface TradeStepView { label: string; state: TradeStepState; at?: number }

/** The job's steps, one per leg, each naming the exchange that does it (the "they" voice). One leg: "Jupiter is swapping it". */
export function tradeSteps(q: CoinQuote, payLabel: string, getLabel: string, at: number): TradeStepView[] {
  const native = NATIVE_SYMBOL[q.chain];
  if (q.legs.length === 1) return [{ label: tradeStep(q.legs[0]!.route), state: "doing", at }];
  return [{ label: tradeStep(q.legs[0]!.route, payLabel, native), state: "doing", at }, { label: tradeStep(q.legs[1]!.route, native, getLabel), state: "waiting" }];
}

/** What the sheet's tracker draws: the steps, and its end once the chain answered (`checking`: sent, not yet seen). */
export interface TradeView { steps: TradeStepView[]; end?: { ok: boolean; line: string }; checking?: string; proof?: { chain: string; hash: string }[] }

/**
 * Runs the trade behind its job: each leg's step turns done as the chain answers; the job ends done with its proof, or
 * stopped with where the money is; a leg sent and not yet seen stays "checking" (never failed). Home's Jobs row (tasks)
 * and the sheet's tracker (`onView`) say the same. Never throws.
 */
export async function runTradeJob(bridge: Bridge, tasks: Tasks | undefined, rowId: string, q: CoinQuote, payLabel: string, getLabel: string, now = Date.now, onView?: (v: TradeView) => void): Promise<"done" | "failed" | "checking"> {
  const steps = tradeSteps(q, payLabel, getLabel, now());
  const native = NATIVE_SYMBOL[q.chain];
  const doneLabel = (i: number) => (q.legs.length === 1 ? tradeStepDone(q.legs[0]!.route) : i === 0 ? tradeStepDone(q.legs[0]!.route, payLabel, native) : tradeStepDone(q.legs[1]!.route, native, getLabel));
  let r: { ok: CoinDone } | { problem: Problem };
  try { r = await bridge.call<CoinDone>("spending.swap.go", { id: q.id }); }
  catch { r = { problem: { code: "shell.job.lost", whatHappened: `${exchanges(q)}'s answer got lost. Activity shows if it swapped.`, money: { state: "needs-you", where: "where it was" }, next: { kind: "nothing", label: "Go back" } } }; }
  if ("problem" in r) {
    const failed = steps.map((s, i) => (i === 0 ? { ...s, state: "failed" as const } : s));
    tasks?.update(rowId, { steps: failed });
    tasks?.end(rowId, "failed", r.problem.whatHappened);
    onView?.({ steps: failed, end: { ok: false, line: r.problem.whatHappened } });
    return "failed";
  }
  const { legs, stopped } = r.ok;
  const at = now();
  const next: TradeStepView[] = steps.map((s, i) => {
    const l = legs[i];
    if (!l) return i === legs.length && (stopped || legs.at(-1)?.status === "done") ? { ...s, state: "failed" } : s;
    if (l.status === "done") return { label: doneLabel(i), state: "done", at };
    return l.status === "unconfirmed" ? { ...s, state: "doing" } : { ...s, state: "failed" };
  });
  const proof = legs.flatMap((l) => l.hashes.slice(-1).map((hash) => ({ chain: CHAIN_OF_PROOF[q.chain], hash })));
  const withProof = proof.length ? { proof } : {};
  if (legs.at(-1)?.status === "unconfirmed") {
    // sent, not yet seen: the row keeps going with the words, never "failed" (Trade's own check follows it)
    tasks?.update(rowId, { steps: next, detail: checkingLine(q, legs.length), ...withProof });
    onView?.({ steps: next, checking: checkingLine(q, legs.length), ...withProof });
    return "checking";
  }
  const ok = !stopped && legs.length === q.legs.length && legs.every((l) => l.status === "done");
  const line = ok ? landedLine(q, getLabel) : stopped ? stopped.whatHappened : notSwapped(q, legs);
  tasks?.update(rowId, { steps: next, ...withProof });
  tasks?.end(rowId, ok ? "done" : "failed", ok ? undefined : line);
  onView?.({ steps: next, end: { ok, line }, ...withProof });
  return ok ? "done" : "failed";
}

/** The sheet's tracker from the trade's view (LiveTracker's shape): the time of each done step from the tap. */
export function trackOf(t: LiveTrack, v: TradeView, now: number): LiveTrack {
  const steps = v.steps.map((s) => ({ label: s.state === "doing" && v.checking ? v.checking : s.label, state: s.state, ...(s.state === "done" && s.at !== undefined ? { atMs: Math.max(0, s.at - t.startMs) } : {}) }));
  return { ...t, steps, ...(v.end ? { end: v.end, endMs: now } : {}) };
}
