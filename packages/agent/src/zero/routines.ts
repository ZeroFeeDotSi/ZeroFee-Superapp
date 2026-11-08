// AgentZero's routines in plain words (A-2, master plan; QA-approved): "every Friday move profits above $100 to my
// Safe", "if SOL drops 20% tell me", "pay $800 to kim.near on the 1st". Read by our own code on this device, never by a
// model: a routine moves money, and no model ever turns words into a money move (the same rule as readPayOnce). Shown
// back word for word, then ONE approval (the core's act-scope sheet: Face ID on the iPhone) for a routine that moves
// money. It runs from the engine's tick under the act door (account.agent.act: the scope, the day's limit, never from the
// Safe, counted before anything moves), so only while ZeroFee is open, and the sheet says so once.
//
// What a routine may do:
// - tell: a line on AgentZero's receipts when it's due (a price fell, one day came). Moves nothing.
// - move: Spending → your Safe (all above an amount, or an amount), through the act door. Never from the Safe.
// - pay: a reminder with the pay sheet on the day; the person's own tap pays (AgentZero pays no one on its own from a
//   routine: the act door has no sheet-free pay yet).
// Anything it can't bound (no amount, "all my money", a payee that isn't a NEAR name) is refused by name.
import { dryRun, type DryRun } from "@zerofee/core/dry-run";
import { isNearName } from "./jobs.ts";

export type RoutineWhen = { every: "week"; day: number } | { every: "month"; day: number } | { price: PriceCoin; dropPct: number }
  /** once, when the swap service answers again ("tell me when 1Click is back"): tells, then turns itself off */
  | { back: "oneclick" };
export type PriceCoin = "SOL" | "NEAR" | "ETH";
export type RoutineDo =
  | { act: "tell" }
  /** Move Spending's money to the Safe: all above `aboveUsd`, or exactly `usd`; at most `limitUsd` each time. */
  | { act: "move"; from: "spending"; to: "safe"; aboveUsd?: number; usd?: number }
  | { act: "pay"; to: string; usd: number };

export interface RoutineTerms {
  /** The person's words, shown back as they wrote them. */
  words: string;
  when: RoutineWhen;
  do: RoutineDo;
  /** The most one run may move, in dollars (0 for tell). */
  limitUsd: number;
}

export interface Routine extends RoutineTerms {
  id: string;
  startedAtIso: string;
  on: boolean;
  /** The last period it ran in ("2026-W45", "2026-11"), so it runs once per period. */
  lastPeriod?: string;
  /** For a price routine: the price it measures the drop from (set at start, and to the new price after it tells). */
  refPrice?: number;
}

export type RoutineReading = { kind: "routine"; terms: RoutineTerms; by: "phone" } | { kind: "cannot"; line: string; by: "phone" };

/** The most one routine run may move (the act door's own day limit is $50 too). */
export const ROUTINE_MAX_USD = 50;
export const RUNS_WHEN_OPEN = "Runs when ZeroFee is open.";
export const ASK_EACH_DAY = "After today, AgentZero asks you to approve it again on the day.";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const COINS: Record<string, PriceCoin> = { sol: "SOL", solana: "SOL", near: "NEAR", eth: "ETH", ether: "ETH", ethereum: "ETH" };
const money = (s: string) => {
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(s);
  return m ? Number(m[1]) : null;
};

/** Does this look like a routine at all (a when)? Null: not a routine (the rule box reads it as before). */
function whenOf(lower: string): RoutineWhen | null | "bad" {
  if (/\b(?:when|once|as soon as)\s+(?:1\s?click|one\s?click|the swap service|swaps?|swapping)\s+(?:is\s+|are\s+|works?\s+)?(?:back|up|working|answering|again)\b/.test(lower)) return { back: "oneclick" };
  const day = DAYS.findIndex((d) => new RegExp(`\\b(?:every|each|on)\\s+${d}s?\\b`).test(lower) || new RegExp(`\\b${d}s\\b`).test(lower));
  if (day >= 0) return { every: "week", day };
  const nth = /\b(?:on\s+the|every|each)\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(lower) ?? /\b(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/.exec(lower);
  if (nth) {
    const d = Number(nth[1]);
    return d >= 1 && d <= 28 ? { every: "month", day: d } : "bad";
  }
  const drop = /\bif\s+([a-z]+)\s+(?:drops|falls|goes down|is down)\s+(?:by\s+)?(\d{1,2})\s*%/.exec(lower);
  if (drop) {
    const coin = COINS[drop[1]!];
    const pct = Number(drop[2]);
    return coin && pct >= 1 && pct <= 90 ? { price: coin, dropPct: pct } : "bad";
  }
  return null;
}

/**
 * Read a routine on this device. Null when the words aren't a routine (no "every …", "on the 1st", "if SOL drops …"); a
 * "cannot" with its reason when they are but can't be bounded.
 */
export function readRoutine(words: string): RoutineReading | null {
  const w = words.trim();
  const lower = w.toLowerCase();
  const when = whenOf(lower);
  if (when === null) return null;
  const by = "phone" as const;
  if (when === "bad") return { kind: "cannot", line: "Say a date from the 1st to the 28th, or a drop from 1% to 90%.", by };
  if (/\b(?:all|everything|every\s+cent)\b(?!\s+above)/.test(lower) && !/\babove\b/.test(lower)) return { kind: "cannot", line: "Say how much. AgentZero never moves all your money.", by };
  if ("back" in when && !/\b(?:tell|let|notify|warn|ping)\s+me\b|\blet me know\b/.test(lower)) return { kind: "cannot", line: "A routine for when the swap service is back can only tell you. Say \"tell me when the swap service is back\".", by };
  if (/\b(?:tell|let|notify|warn|ping)\s+me\b|\blet me know\b/.test(lower) && !/\b(?:move|pay|send)\b/.test(lower)) {
    return { kind: "routine", terms: { words: w, when, do: { act: "tell" }, limitUsd: 0 }, by };
  }
  if (/\bpay\b|\bsend\b/.test(lower)) {
    const usd = money(lower);
    const to = /\bto\s+([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.near)\b/.exec(lower)?.[1];
    if (usd === null || !to) return { kind: "cannot", line: "Say who gets it and how much, like \"pay $800 to kim.near on the 1st\".", by };
    if (!isNearName(to)) return { kind: "cannot", line: "AgentZero pays NEAR names for now, like kim.near.", by };
    if (!(usd > 0 && usd <= 10_000)) return { kind: "cannot", line: "Say an amount up to $10,000.", by };
    return { kind: "routine", terms: { words: w, when, do: { act: "pay", to, usd }, limitUsd: usd }, by };
  }
  if (/\bmove\b|\bput\b|\bsweep\b/.test(lower) && /\b(?:my\s+)?safe\b/.test(lower)) {
    if ("price" in when) return { kind: "cannot", line: "A price routine can only tell you. Say \"tell me\".", by };
    const above = /\babove\s+\$\s*(\d+(?:\.\d{1,2})?)/.exec(lower);
    const upTo = /\b(?:up to|at most|max(?:imum)?)\s+\$\s*(\d+(?:\.\d{1,2})?)/.exec(lower);
    const limit = Math.min(upTo ? Number(upTo[1]) : ROUTINE_MAX_USD, ROUTINE_MAX_USD);
    if (above) return { kind: "routine", terms: { words: w, when, do: { act: "move", from: "spending", to: "safe", aboveUsd: Number(above[1]) }, limitUsd: limit }, by };
    const usd = money(lower);
    if (usd === null) return { kind: "cannot", line: "Say how much to move, like \"move $20 to my Safe every Friday\".", by };
    if (usd > ROUTINE_MAX_USD) return { kind: "cannot", line: `A routine moves at most $${ROUTINE_MAX_USD} each time.`, by };
    return { kind: "routine", terms: { words: w, when, do: { act: "move", from: "spending", to: "safe", usd }, limitUsd: usd }, by };
  }
  return { kind: "cannot", line: "A routine can tell you, move money from your NEAR wallet to your Safe, or remind you to pay someone.", by };
}

const nth = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
const dollars = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

/** When, in words: "Every Friday", "On the 1st of each month", "When SOL falls 20%". */
export function whenWords(w: RoutineWhen): string {
  if ("back" in w) return "When the swap service is back";
  if ("price" in w) return `When ${w.price} falls ${w.dropPct}%`;
  return w.every === "week" ? `Every ${DAYS[w.day]![0]!.toUpperCase()}${DAYS[w.day]!.slice(1)}` : `On the ${nth(w.day)} of each month`;
}

/** What it does, in words. */
export function doWords(d: RoutineDo, limitUsd: number): string {
  if (d.act === "tell") return "AgentZero tells you. Nothing moves.";
  if (d.act === "pay") return `AgentZero reminds you to pay ${dollars(d.usd)} to ${d.to}. You pay it with a tap.`;
  if (d.aboveUsd !== undefined) return `AgentZero moves what's above ${dollars(d.aboveUsd)} in your NEAR wallet to your Safe, at most ${dollars(limitUsd)} each time.`;
  return `AgentZero moves ${dollars(d.usd ?? 0)} from your NEAR wallet to your Safe.`;
}

/** A "tell me" routine's line in place of a dry run: nothing moves, so there's no cost to show. */
export const TELL_ONLY = "I'll only tell you. Nothing moves.";

/**
 * The routine's dry run (A-12), for a routine that moves or pays: its one step and the most a run can cost, priced from its
 * own terms (a move at most its limit; a pay reminder at its amount, paid only on the person's tap), and what it never
 * touches. A tell routine has none.
 */
export function routineDry(t: RoutineTerms): DryRun | null {
  if (t.do.act === "tell") return null;
  const usd = t.do.act === "pay" ? t.do.usd : Math.min(t.limitUsd, ROUTINE_MAX_USD);
  return dryRun([{ words: `${whenWords(t.when)}: ${doWords(t.do, t.limitUsd)}`, usd }], {
    never: t.do.act === "move" ? ["Never takes from your Safe."] : ["Never without your tap."],
    per: "each time",
  });
}

/** The routine's sheet: the words shown back as written, then the dry run (or the tell line), then the open-app line once. */
export function routineLines(t: RoutineTerms): string[] {
  const lines = [`You said: "${t.words}"`];
  const dry = routineDry(t);
  if (!dry) lines.push(`${whenWords(t.when)}: ${TELL_ONLY}`);
  else lines.push(...dry.lines);
  if (t.do.act === "move") lines.push(ASK_EACH_DAY);
  lines.push(RUNS_WHEN_OPEN);
  return lines;
}

/** The act scope its one approval sets (a moving routine only): moves from Spending, at most its limit, for today. */
export function routineScope(t: RoutineTerms): { kinds: ["move"]; places: ["spending"]; payees: []; dayUsd: number; minutes: number } | null {
  return t.do.act === "move" ? { kinds: ["move"], places: ["spending"], payees: [], dayUsd: Math.min(t.limitUsd, ROUTINE_MAX_USD), minutes: 24 * 60 } : null;
}

/** The period a run belongs to, so a routine runs once per period: ISO week for weekly, month for monthly. */
export function periodOf(w: RoutineWhen, nowMs: number): string | null {
  if ("price" in w || "back" in w) return null;
  const d = new Date(nowMs);
  if (w.every === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  // ISO week: Thursday of this week decides the year.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Is it due now? A daily routine on its day (or later in the same period, if ZeroFee wasn't open on the day), once per
 *  period; a price routine when the price is at or under its reference less the drop. */
export function isDue(r: Routine, nowMs: number, price: number | null, swapsUp: boolean | null = null): boolean {
  if (!r.on) return false;
  const w = r.when;
  if ("back" in w) return swapsUp === true;
  if ("price" in w) return price !== null && r.refPrice !== undefined && price <= r.refPrice * (1 - w.dropPct / 100);
  const period = periodOf(w, nowMs)!;
  if (r.lastPeriod === period) return false;
  const d = new Date(nowMs);
  if (w.every === "month") return d.getDate() >= w.day;
  // Weeks run Monday to Sunday (as the period's ISO week does): due from its day on, until the week ends.
  const iso = (x: number) => (x + 6) % 7;
  return iso(d.getDay()) >= iso(w.day);
}

/** What one due run does, given what the engine read (Spending's total, the coin's price). */
export type RoutineRun =
  | { kind: "tell"; line: string }
  | { kind: "move"; usd: number; line: string }
  | { kind: "remind-pay"; to: string; usd: number; line: string }
  | { kind: "skip"; line: string };

export function routineRun(r: Routine, facts: { spendingUsd: number | null; price: number | null }): RoutineRun {
  const d = r.do;
  if (d.act === "tell") {
    const w = r.when;
    if ("back" in w) return { kind: "tell", line: "The swap service is back. You can swap again." };
    if ("price" in w && facts.price !== null && r.refPrice !== undefined) return { kind: "tell", line: `${w.price} fell ${w.dropPct}%: from ${dollars(Math.round(r.refPrice * 100) / 100)} to ${dollars(Math.round(facts.price * 100) / 100)}.` };
    return { kind: "tell", line: `${whenWords(r.when)}: your routine "${r.words}".` };
  }
  if (d.act === "pay") return { kind: "remind-pay", to: d.to, usd: d.usd, line: `It's time to pay ${dollars(d.usd)} to ${d.to}. Open AgentZero to pay it.` };
  if (d.aboveUsd !== undefined) {
    if (facts.spendingUsd === null) return { kind: "skip", line: "Your NEAR wallet couldn't be read. Nothing moved." };
    const extra = Math.floor((facts.spendingUsd - d.aboveUsd) * 100) / 100;
    if (!(extra > 0)) return { kind: "skip", line: `Your NEAR wallet is under ${dollars(d.aboveUsd)}. Nothing moved.` };
    const usd = Math.min(extra, r.limitUsd);
    return { kind: "move", usd, line: `Moving ${dollars(usd)} from your NEAR wallet to your Safe.` };
  }
  return { kind: "move", usd: Math.min(d.usd ?? 0, r.limitUsd), line: `Moving ${dollars(Math.min(d.usd ?? 0, r.limitUsd))} from your NEAR wallet to your Safe.` };
}

/** The asset ids the engine reads a coin's price by (ledger.tokens), for price routines. */
export const PRICE_ASSET: Record<PriceCoin, string> = {
  SOL: "nep141:sol.omft.near",
  NEAR: "nep141:wrap.near",
  ETH: "nep141:eth.omft.near",
};
