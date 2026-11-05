// One source for every job's steps and words (product decision, 5 Nov; JOB-TRACKER-SPEC §3): each step names
// the protocol doing the work, and THEY take the time ("NEAR Intents is moving it to Solana"), never "we", never "about a
// minute". A step's doing form while it runs, its done form once a chain or 1Click read shows it (never a timer). The
// tracker (<JobTracker>, packages/design), Home's "Jobs" rows, the Activity centre and every job sheet read these words;
// the engines say only where the work stands. Words: the copywriter, 5 Nov.

import { onPhone } from "./approval-words.ts";

/** The protocols a job's steps name. */
export const PROTOCOL = { near: "NEAR", intents: "NEAR Intents", oneclick: "1Click", solana: "Solana", jupiter: "Jupiter", pump: "pump.fun" } as const;

export type JobStepKey = "safe" | "near" | "intents" | "land" | "checking";
/** One step's words: what it says before it begins (`next`, the plain future with "Then": a step not begun never reads
 *  as happening, the copy review's ruling 5 Nov), while it runs, and once a read shows it done. `chain`: a landing step's own chain. */
export interface StepWords { key: JobStepKey; doing: string; done: string; next?: string; chain?: string }

const CHAIN_NAME: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
const WALLET: Record<string, string> = { sol: "your SOL wallet", hood: "your ETH (RH) wallet", bsc: "your BNB wallet", near: "your NEAR wallet", safe: "your Safe" };

export const JOB_STEP_WORDS = {
  /** The Safe's own signature (Face ID): done once NEAR's final block has its transaction. Until then nothing suggests
   *  money moving (QA's SHOULD on the job made at the tap, 5 Nov; words: the look builder's word table). */
  safe: { key: "safe", doing: "Approve on your iPhone.", done: "Approved", next: "Then you approve on your iPhone." },
  /** NEAR Intents brings it into the NEAR wallet's private balance: done once a NEAR read shows it there. */
  near: { key: "near", doing: `${PROTOCOL.intents} is moving it to your NEAR wallet`, done: "In your NEAR wallet", next: `Then ${PROTOCOL.intents} moves it to your NEAR wallet.` },
  /** A page closed while the Safe signed: the chain and 1Click are asked whether it went. */
  checking: { key: "checking", doing: "Asking NEAR if your Safe sent it", done: "Your Safe signed", next: "Then NEAR confirms your Safe sent it." },
} as const satisfies Record<string, StepWords>;

/** A chain landing it in its wallet, one line per chain (the copy review's ruling, 5 Nov: never "Each chain"). */
export const landStep = (c: string, where = WALLET[c] ?? "your wallet"): StepWords => {
  const chain = c === "near" ? "NEAR" : CHAIN_NAME[c] ?? "That chain";
  return { key: "land", chain: c, doing: `${chain} is landing it in ${where}.`, done: `It's in ${where}.`, next: `Then ${chain} lands it in ${where}.` };
};

/** The Safe's approval, said for where ZeroFee runs (the copy review's ruling, 5 Nov): inside the iPhone app it is Face ID on this
 *  phone; on the web or a laptop the iPhone is the other device. `phone`: approval-words.ts onPhone, tests pass their own. */
export const approveStep = (phone: boolean = onPhone()): StepWords =>
  phone ? { key: "safe", doing: "Approve with Face ID.", done: "Approved", next: "Then you approve with Face ID." } : JOB_STEP_WORDS.safe;

/** NEAR Intents on to a chain's wallet (one or several), then each chain landing it, one line per chain. */
export function onwardSteps(to: readonly string[]): StepWords[] {
  if (to.length !== 1) return [{ key: "intents", doing: `${PROTOCOL.intents} is moving it to your wallets`, done: `${PROTOCOL.intents} moved it to your wallets`, next: `Then ${PROTOCOL.intents} moves it to your wallets.` }, ...to.map((c) => landStep(c))];
  const c = to[0]!;
  const chain = CHAIN_NAME[c] ?? "that chain";
  return [
    { key: "intents", doing: `${PROTOCOL.intents} is moving it to ${chain}`, done: `${PROTOCOL.intents} moved it to ${chain}`, next: `Then ${PROTOCOL.intents} moves it to ${chain}.` },
    { key: "land", chain: c, doing: `${chain} is landing it`, done: `In ${WALLET[c] ?? "your wallet"}`, next: `Then ${chain} lands it in ${WALLET[c] ?? "your wallet"}.` },
  ];
}

/** A Move from the Safe to wallets on other chains (or to the NEAR wallet alone): every step, in order. */
export function safeMoveSteps(to: readonly string[], o: { checking?: boolean; phone?: boolean } = {}): StepWords[] {
  const first = o.checking ? JOB_STEP_WORDS.checking : approveStep(o.phone);
  const onward = to.filter((c) => c !== "near");
  return [first, JOB_STEP_WORDS.near, ...(onward.length ? onwardSteps(onward) : [])];
}

/** A Move paid from Private (the product's HARD RULE, NEAR Confidential): the Safe's fill first when Private was short
 *  (its Face ID on the Safe's own sheet), then NEAR Confidential paying each wallet (a Swap: NEAR Intents swapping it),
 *  then that chain landing it. Every step shown, each naming who does the work (rule 11; QA's Sim re-check, 5 Nov: a
 *  job's page had one step, no ticks). Words: the copywriter, 5 Nov; the swap and landing steps: the look builder to read. */
export function privateMoveSteps(to: readonly string[], o: { fill?: boolean; where?: string; swapFor?: string } = {}): StepWords[] {
  const where = o.where ?? (to.length === 1 ? WALLET[to[0]!] ?? "your wallet" : "your wallets");
  return [
    // done: what the step did, never where the money is now (Sim recheck: "Your money is in Private." sat over
    // "It's in your SOL wallet." on one job)
    ...(o.fill ? [{ key: "safe" as const, doing: "NEAR Confidential is moving money from your Safe to Private.", done: "NEAR Confidential moved it to Private.", next: "Then your Safe fills Private." }] : []),
    o.swapFor
      ? { key: "intents" as const, doing: `${PROTOCOL.intents} is swapping it for ${o.swapFor}.`, done: `${PROTOCOL.intents} swapped it for ${o.swapFor}.`, next: `Then ${PROTOCOL.intents} swaps it for ${o.swapFor}.` }
      : { key: "intents" as const, doing: `NEAR Confidential is paying ${where}.`, done: `NEAR Confidential paid ${where}.`, next: `Then NEAR Confidential pays ${where}.` },
    // one line per chain, each in its own wallet (a site's Add: the site's wallet, on Solana)
    ...(to.length === 1 ? [landStep(to[0]!, where)] : to.map((c) => landStep(c))),
  ];
}

/** The first step of a job made at the Safe's yes (Move, a site's top-up, AgentZero's Add money, Swap or Send from the
 *  Safe): the starting row's one step until the engine's own row takes over. */
export const startingStep = (phone?: boolean): string => approveStep(phone).doing;

/** The tracker's time line, from the protocol's own quotes (seconds), else what this route took on recent moves. */
export function etaLine(o: { quotedSec?: number; measuredSec?: number; by?: string }): string | null {
  const by = o.by ?? PROTOCOL.intents;
  const s = o.quotedSec ?? o.measuredSec;
  if (!(typeof s === "number" && s > 0)) return null;
  const t = s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
  return o.quotedSec !== undefined ? `${by} says it takes about ${t}.` : `${by} took about ${t} on recent moves.`;
}

/** Measured on mainnet (QA, 5 Nov: Safe → SOL, approve → in the SOL wallet 200–212 s; site top-ups 128–136 s). */
export const MEASURED_SEC = { safeToChain: 210, safeToNear: 30 } as const;
/** Each route's time as measured on mainnet, the slowest seen (QA's real-money matrix, 5 Nov, HOPS.md): a chain
 *  wallet into NEAR or the Safe 79–112 s (hops 1–4: said "about 30 s"); the NEAR wallet to the Safe 10 s (hops 11–12),
 *  the same NEAR transfer as a fill of AgentZero's wallet; Private out to a chain wallet 23 s to Robinhood (hops 6–7),
 *  Solana not yet measured, so a minute until it is; the Safe on to a chain about 4 min (a UI test, 4 Nov). Every job's time
 *  left counts from these, and past one the row says by how much. */
export const LEG_SEC = { safeToChain: 240, chainIn: 112, nearToSafe: 10, nearOut: 30, privateOut: 30, privateNear: 10, privateSwap: 60, read: 4, other: 60 } as const;
// privateOut (QA's Sim re-check, 5 Nov: a Move said "About 1 min" and was done in 18-30 s): Private out to a chain wallet,
// 23 s to Robinhood on mainnet (hops 6-7) and 18-30 s to Solana on the Sim; the slowest seen, 30 s, until a mainnet
// Solana lap. privateNear (QA's Sim re-check: a Send to bob.near said "58 s left" and was Done a second later): Private
// paying a NEAR account is one NEAR transfer, the NEAR wallet -> Safe hop's own (10 s, hops 11-12), never a chain's
// payout. privateSwap: a Swap paid from Private (NEAR Intents swaps it on the way), a minute as before. read: the watch's
// read while a job goes (live-steps watchLive, every 4 s): a chain read's own wait after the step before it ticked.

/** A Send's time left (QA's MUST, Sim test: "This job has no time estimate."), from the measured legs
 *  above: NEAR Confidential pays a NEAR payee from Private (privateOut), any other chain's as the Safe -> chain route
 *  (safeToChain); a chain wallet's coins first come into NEAR (chainIn). `row`: the chain wallet it leaves, none from the Safe. */
export const sendSec = (o: { row?: string | null | undefined; toNear: boolean }): number => sendLegs(o).reduce((n, s) => n + s, 0);
/** A Send's legs, one per step of its job (live-steps sendTrack: leaving, through, paid): the wallet's coins into NEAR
 *  first (a chain wallet's), the payout, then the payee's chain read. The one time model: the receipt's time is their sum,
 *  and the job's time left counts down the steps not yet ticked (legsEndsAt). */
export const sendLegs = (o: { row?: string | null | undefined; toNear: boolean }): number[] => {
  const pay = o.toNear ? LEG_SEC.privateNear : LEG_SEC.safeToChain;
  return [o.row && o.row !== "near" ? LEG_SEC.chainIn : 0, pay - LEG_SEC.read, LEG_SEC.read];
};

/** When a job ends, from its legs (the one time model, product decision, 5 Nov; QA's Sim re-check: times said and
 *  taken disagreed): from the last step a read ticked (its own time), plus each step still to tick. Before any tick, from
 *  the start. So the time left shrinks on the real legs: a step that ticks early pulls the end in, a late one pushes it. */
export function legsEndsAt(startMs: number, steps: readonly { state: string; atMs?: number }[], legSec: readonly number[]): number | undefined {
  if (!Number.isFinite(startMs) || legSec.length !== steps.length) return undefined;
  let last = -1;
  steps.forEach((s, i) => { if (s.state === "done") last = i; });
  const anchor = last >= 0 ? startMs + (steps[last]!.atMs ?? 0) : startMs;
  const rest = legSec.slice(last + 1).reduce((n, s) => n + s, 0);
  return Number.isFinite(anchor) ? anchor + rest * 1000 : undefined;
}

/** The step's words in its state: doing while it runs, done once shown done; not begun, its "Then …" (copy review, 5 Nov). */
export const stepLabel = (w: StepWords, state: "waiting" | "doing" | "done" | "failed"): string => (state === "doing" || state === "failed" ? w.doing : state === "waiting" ? w.next ?? w.doing : w.done);

/** The crawl's marks (spec §1, QA): `step:<key>:<state>` once per change, and the same line in __zfTap. */
export function markStep(key: string, state: string): void {
  try {
    globalThis.performance?.mark?.(`step:${key}:${state}`);
    const g = globalThis as { __zfTap?: unknown[] };
    if (Array.isArray(g.__zfTap)) g.__zfTap.push(`step:${key}:${state}`);
  } catch { /* a mark is never a reason to fail */ }
}

/** The time LEFT on every job (product decision, 5 Nov; QA's Jobs hunt B3: rows only counted the time spent),
 *  from the protocol's own estimate (a quote's seconds, or the route's measured time): never a made-up number; none, said
 *  so. Words: the copywriter, 5 Nov ("any moment" is never said, VOICE.md). */
export const TIME_WORDS = { none: "No time estimate", receiptNone: "This job has no time estimate.", almost: "Almost there.", slow: "Slower than usual.", /** the copy review's rule (5 Nov): a job that landed before its estimate */ early: "Landed early." } as const;
const secs = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
const inWords = (s: number) => (s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`);
/** A going job's row: "12 s left", "3 min left"; none, "No time estimate". Past its estimate it never blames the
 *  estimate (QA's Sim walk, 5 Nov: "30 s longer than shown"): "Almost there." while it has run under twice the
 *  estimate (`startMs`: when it began), then "Slower than usual." (the copy review's ruling: full stops, no figure). No start known:
 *  "Almost there.". */
export function timeLeft(endsAt: number | undefined, now: number, startMs?: number): string {
  if (!(typeof endsAt === "number" && Number.isFinite(endsAt))) return TIME_WORDS.none;
  if (endsAt > now) return `${inWords(secs(endsAt - now))} left`;
  const slow = typeof startMs === "number" && Number.isFinite(startMs) && endsAt > startMs && now - startMs > 2 * (endsAt - startMs);
  return slow ? TIME_WORDS.slow : TIME_WORDS.almost;
}
/** The receipt's line under "Job created.": "About 4 min left.", or that there is no estimate. `landedAt`: when the job
 *  landed (landedOf): before its estimate, "Landed early." (the copy review's one rule for every receipt, 5 Nov: never a frozen "About 4
 *  min left" over money already there); after it, the past-estimate words as they stood then. */
export function receiptLeft(endsAt: number | undefined, now: number, startMs?: number, landedAt?: number): string {
  if (!(typeof endsAt === "number" && Number.isFinite(endsAt))) return TIME_WORDS.receiptNone;
  const landed = typeof landedAt === "number" && Number.isFinite(landedAt) ? landedAt : undefined;
  if (landed !== undefined && landed <= endsAt) return TIME_WORDS.early;
  const at = landed ?? now;
  return endsAt > at ? `About ${inWords(secs(endsAt - at))} left.` : timeLeft(endsAt, at, startMs);
}
/** A receipt's job landed (TimeLeft): the rows made since the receipt opened (`since`, a little before: the tap's own row
 *  can be stamped first), all ended done; when the last of them did. A job's starting row ("job:", ended when its real
 *  rows take over) never counts; nothing made yet, one still going or one that stopped: undefined (not landed). */
export function landedOf(list: readonly { id: string; state: string; startedAt: number; endedAt?: number }[], since: number): number | undefined {
  const mine = list.filter((t) => !t.id.startsWith("job:") && t.startedAt >= since - LANDED_SLACK_MS);
  if (!mine.length || !mine.every((t) => t.state === "done" && typeof t.endedAt === "number")) return undefined;
  return Math.max(...mine.map((t) => t.endedAt!));
}
/** How far before the receipt opened its job's own row may be stamped (made at the tap, the receipt a frame later). */
export const LANDED_SLACK_MS = 5_000;
