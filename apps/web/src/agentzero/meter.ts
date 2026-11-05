// AgentZero's cost meter on top (product decision, 4 Nov: "a cost bar on top that goes up over time, and it gets cut from the agent
// wallet every [minimum amount]"): what AgentZero has used today. It rises while a reply streams (an estimate from the
// words so far) and snaps to the reply's exact cost when the relay says it; it starts again at local midnight. The
// wallet pays ZeroFee in one go each time what it owes reaches $0.25 (use-agent-wallet.ts). Pure: the tests drive it.
import { REPLY_PRICES } from "@zerofee/core/agent-price";
import type { ReplyOwed } from "@zerofee/agent/chat/turn";

/** Today's figures, kept on this phone (device.store), in micro-dollars. */
export interface Meter {
  /** The local day they belong to ("2026-11-04"). */
  day: string;
  /** What AgentZero's replies cost today: exact once the relay said it, an estimate for a Stop until then. */
  usedMicros: number;
  /** What AgentZero's wallet paid ZeroFee today. */
  paidMicros: number;
}

/** Where the meter is kept on this phone. */
/** v2 (QA 5 Nov: "paid $0.678" beside $0.028 of receipts): the day's figures kept before the doubling fix
 *  (d21e2ac76) were doubled again and again; a new key starts the meter clean, and nothing reads the old one. */
export const METER_KEY = "agentzero.meter.v2";

/** The local day of `now` ("2026-11-04"): the meter starts again at local midnight. */
export const dayOf = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
/** How long until the next local midnight, in ms. */
export const untilMidnight = (now: Date = new Date()): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

/** The meter as kept, for `day`: another day's (yesterday's) reads as nothing used yet. */
export function readMeter(raw: unknown, day: string): Meter {
  const zero = { day, usedMicros: 0, paidMicros: 0 };
  if (typeof raw !== "string") return zero;
  try {
    const m = JSON.parse(raw) as Partial<Meter>;
    const n = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
    return m && m.day === day ? { day, usedMicros: n(m.usedMicros), paidMicros: n(m.paidMicros) } : zero;
  } catch {
    return zero;
  }
}

/**
 * The meter once this phone's kept figures are read: the kept ones, plus only what was heard before that first read
 * answered (QA, 5 Nov: the read ran again on each new shell context and added the whole meter to itself:
 * $0.027 became $0.054, paid read $0.650 for 1.4¢ of receipts). Pure: the tests run it.
 */
export function keptPlusEarly(kept: Meter, early: Meter): Meter {
  if (early.day !== kept.day) return kept;
  return { day: kept.day, usedMicros: kept.usedMicros + early.usedMicros, paidMicros: kept.paidMicros + early.paidMicros };
}

/** One token for every 3 characters streamed: the relay's own Stop estimate (agentzero-chat.mjs streamedTokens). */
export const CHARS_PER_TOKEN = 3;

/**
 * While a reply streams: what its words so far cost at the model's output price (the reply's own input and thinking
 * come with its exact figure at the end). 0 between replies. `items`: the chat's items (use-chat-turn ChatItem); the
 * reply's words are the "agent" text since the last thing that ended a call (the person's words, a call's cost, a Stop).
 */
export function streamMicros(items: readonly { kind: string; text?: unknown }[], busy: boolean, model: string | undefined): number {
  if (!busy) return 0;
  let chars = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "you" || it.kind === "cost" || it.kind === "stopped") break;
    if (it.kind === "agent") chars += String(it.text ?? "").length;
  }
  const prices = REPLY_PRICES as Record<string, { output: number }>;
  const price = (model && prices[model]?.output) || REPLY_PRICES["claude-opus-5-5"].output;
  return Math.ceil(chars / CHARS_PER_TOKEN) * price;
}

/** A batch's whole cost so far: what is still owed and what was paid of it. */
const batchTotal = (o: ReplyOwed): number => o.owedMicros + (o.paidMicros ?? 0);

/**
 * What a new figure from the relay adds to today's meter: this call's exact cost (`turnMicros`, 0 for a 402 or an ask),
 * plus what the relay counted that this phone never heard (a stopped reply's own figure), less the estimates this phone
 * put in for those (`estMicros`). `prev`: the last figure heard; `known`: this phone knows where the batch stood (after a
 * payment closed it, or the relay was asked), so anything new in it is new.
 */
export function heardMicros(prev: ReplyOwed | null, known: boolean, next: ReplyOwed | null, turnMicros: number, estMicros: number): number {
  // nothing heard about the batch's last part (it closed: paid): an estimate on the meter stays as it is
  if (!known || !next) return turnMicros;
  const before = prev && next && prev.reply === next.reply ? batchTotal(prev) : 0;
  // what the relay asks is never above the summed usage's price: a few millionths of a dollar of rounding are no Stop
  const unseen = next ? batchTotal(next) - before - turnMicros : 0;
  return turnMicros + (unseen > (next?.replies ?? 1) ? unseen : 0) - estMicros;
}

/**
 * The month as the sheet shows it: what AgentZero used, so what was paid (the core counts a payment when it signs it)
 * plus what it owes now (a batch not paid yet), the same used the "Used today" line adds up. Never less than what it
 * owes: "This month $0.000 of $20" under "owed $0.037" was two lines disagreeing (product decision, 4 Nov).
 */
export function monthShown<M extends { spentUsd: number }>(month: M | null, owedUsd: number): M | null {
  return month ? { ...month, spentUsd: month.spentUsd + (owedUsd > 0 ? owedUsd : 0) } : null;
}
