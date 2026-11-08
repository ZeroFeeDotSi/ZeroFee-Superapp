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
const WALLET: Record<string, string> = { sol: "your SOL wallet", hood: "your Robinhood wallet", bsc: "your BNB wallet", near: "your NEAR wallet", safe: "your Safe" };

export const JOB_STEP_WORDS = {
  /** The Safe's own signature (Face ID): done once NEAR's final block has its transaction. Until then nothing suggests
   *  money moving (QA's SHOULD on the job made at the tap, 5 Nov; words: the look builder's word table). */
  safe: { key: "safe", doing: "Approve on your iPhone.", done: "Approved", next: "Then you approve on your iPhone." },
  /** NEAR Intents brings it into the NEAR wallet's private balance: done once a NEAR read shows it there. */
  near: { key: "near", doing: `${PROTOCOL.intents} is moving it to your NEAR wallet`, done: "In your NEAR wallet", next: `Then ${PROTOCOL.intents} moves it to your NEAR wallet.` },
  /** A page closed while the Safe signed: the chain and 1Click are asked whether it went. */
  checking: { key: "checking", doing: "Asking NEAR if your Safe sent it", done: "Your Safe signed", next: "Then NEAR confirms your Safe sent it." },
} as const satisfies Record<string, StepWords>;

/** A Safe Buy or Sell's three steps (rule 11; copy at grade 5), for the coin got (`got`): through NEAR Confidential only.
 *  One source for the trade's receipt and Jobs row (trade native/swap.ts) and its Activity page (wallet swap-detail.ts,
 *  builder 22's item 2). */
export const safeTradeSteps = (got: string) => [
  { doing: "NEAR Confidential is moving it from your Safe to Private.", done: "NEAR Confidential moved it to Private.", next: "First it goes into Private." },
  { doing: `${PROTOCOL.intents} is swapping it for ${got}.`, done: `${PROTOCOL.intents} swapped it for ${got}.`, next: `Then ${PROTOCOL.intents} swaps it for ${got}.` },
  { doing: "It's on its way back to your Safe.", done: "It's in your Safe.", next: "Then it comes back to your Safe." },
] as const;

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
export const LEG_SEC = { safeToChain: 240, chainIn: 112, nearToSafe: 10, nearOut: 30, privateOut: 30, privateNear: 10, privateSwap: 60, read: 4, other: 60, safeFill: MEASURED_SEC.safeToNear } as const;
// safeFill (the audit's S8, 7 Nov: a Move that fills Private said "about 30 s", only its second leg): the Safe's fill into Private
// before Private pays out, one Safe-signed NEAR move, timed as the measured Safe -> NEAR hop (MEASURED_SEC.safeToNear).

/** A Move leg's time, the one estimator (the audit's S8, 7 Nov; the Move sheet's legTime, its job, and Trade's fee-first Sell all
 *  count from it): the Safe's side on to a chain wallet is Private's payout (privateOut), plus the Safe's fill into Private
 *  first when the Move needs one (`fill`); a chain wallet into NEAR or the Safe (chainIn); the NEAR wallet home (nearToSafe);
 *  the NEAR wallet on to a chain wallet or in from the Safe's side (nearOut). Places: safe, private, near, or a chain's. */
export function moveLegSec(from: string, to: string, o: { fill?: boolean } = {}): number {
  const side = (p: string) => p === "safe" || p === "private", chain = (p: string) => !side(p) && p !== "near";
  if (side(from) && chain(to)) return LEG_SEC.privateOut + (from === "safe" && o.fill ? LEG_SEC.safeFill : 0);
  if (chain(from) && (to === "near" || side(to))) return LEG_SEC.chainIn;
  if (from === "near" && side(to)) return LEG_SEC.nearToSafe;
  return from === "near" || to === "near" ? LEG_SEC.nearOut : LEG_SEC.other;
}
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
export const TIME_WORDS = { none: "No time estimate", receiptNone: "This job has no time estimate.", almost: "Almost there.", slow: "Slower than usual.", /** the copy review's words (7 Nov, item 3): a job that landed in under a second */ underSecond: "Done in under a second." } as const;
/** How long a landed job took, said on its receipt (copy review, 7 Nov: never "Landed early."): "Done in under a second.", else
 *  "Done in 12 seconds." or "Done in 3 min." (provisional). `ms`: from the receipt's start to its landing. */
export function doneIn(ms: number): string {
  return Number.isFinite(ms) && ms < 1000 ? TIME_WORDS.underSecond : `Done in ${receiptWords(secs(Number.isFinite(ms) ? ms : 0))}.`;
}
const secs = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
const inWords = (s: number) => (s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`);
/** How long a done job took, on its Jobs row ("5 s", "2 min"): the receipt's own count (doneIn's secs), so the row and the
 *  receipt never give two answers for one job (QA 16, 8 Nov: "Done in 5 s" beside "Done in 6 seconds."); null under a
 *  second (the row says "Done"). */
/** M12-1 (8 Nov): how long a landed job took, on its receipt under "Done.": "Took 11 s." (the Jobs row's own figure,
 *  rowTook), "Took under a second.", "Took 3 min.". Never "Done in" under a "Done." head (said once). */
export function tookIn(ms: number): string {
  return `Took ${rowTook(ms) ?? "under a second"}.`;
}
export function rowTook(ms: number): string | null {
  return Number.isFinite(ms) && ms >= 1000 ? inWords(secs(ms)) : null;
}
/** The receipt's own spelling (the copy review's J5, 7 Nov: "About 30 seconds left."): seconds in words, minutes as "min". */
const receiptWords = (s: number) => (s < 60 ? `${s} second${s === 1 ? "" : "s"}` : `${Math.ceil(s / 60)} min`);
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
/** The receipt's time line: "About 4 min left.", or that there is no estimate. `landedAt`: when the job landed, as the
 *  rows' own reads ended it (landedOf): how long it took, from `startMs` (doneIn: "Done in under a second."), early or
 *  late alike (copy review, 7 Nov: never "Landed early.", never a frozen "About 4 min left" over money already there); with no
 *  start known, the past-estimate words as they stood then. */
export function receiptLeft(endsAt: number | undefined, now: number, startMs?: number, landedAt?: number): string {
  const landed = typeof landedAt === "number" && Number.isFinite(landedAt) ? landedAt : undefined;
  const started = typeof startMs === "number" && Number.isFinite(startMs) ? startMs : undefined;
  if (landed !== undefined && started !== undefined) return tookIn(landed - started);
  if (!(typeof endsAt === "number" && Number.isFinite(endsAt))) return TIME_WORDS.receiptNone;
  const at = landed ?? now;
  return endsAt > at ? `About ${receiptWords(secs(endsAt - at))} left.` : timeLeft(endsAt, at, startMs);
}
/** The rows a receipt follows (QA's finding, made a MUST by QA, 7 Nov): `own` given, this job's own
 *  rows only (job-start.ts jobRows: its starting row and the ids it was made with), whenever they started, so another
 *  job on other money started within the slack never lends this receipt its stop words or its landing. With no `own`
 *  (a receipt that knows no job id), the fallback: the rows started since the receipt opened (`since`, a little before:
 *  the tap's own row can be stamped first). */
export function receiptRows<T extends { id: string; startedAt: number }>(list: readonly T[], since: number, own?: (id: string) => boolean): T[] {
  return list.filter(own ? (t) => own(t.id) : (t) => t.startedAt >= since - LANDED_SLACK_MS);
}
/** A receipt's job landed (TimeLeft): its rows (receiptRows), all ended done; when the last of them did. A job's starting
 *  row ("job:", ended when its real rows take over) never counts; nothing made yet, one still going or one that
 *  stopped: undefined (not landed). */
export function landedOf(list: readonly { id: string; state: string; startedAt: number; endedAt?: number }[], since: number, own?: (id: string) => boolean): number | undefined {
  const mine = receiptRows(list, since, own).filter((t) => !t.id.startsWith("job:"));
  if (!mine.length || !mine.every((t) => t.state === "done" && typeof t.endedAt === "number")) return undefined;
  return Math.max(...mine.map((t) => t.endedAt!));
}
/** One clock for one job (QA 16's MUST, 8 Nov: the going Swap receipt said "About 1 min left." beside its Jobs row's "3 min
 *  left"): when the job's own rows say it ends, the time the Jobs row counts down to (each row's endsAt, set from the
 *  Approve for a Safe job, then the core's own row's); the latest of its rows still going. None: undefined (the receipt
 *  keeps its tap-time estimate). Pure. */
export function jobEndsAt(list: readonly { id: string; state: string; endsAt?: number }[], own: (id: string) => boolean): number | undefined {
  const going = list.filter((t) => own(t.id) && t.state === "pending" && typeof t.endsAt === "number" && Number.isFinite(t.endsAt));
  // the core's rows once they exist (the Jobs list shows them; the tap's starting row "job:" goes at the hand-off)
  const real = going.filter((t) => !t.id.startsWith("job:"));
  const ends = (real.length ? real : going).map((t) => t.endsAt!);
  return ends.length ? Math.max(...ends) : undefined;
}
/** One tick for every clock of a job (QA 16, 8 Nov: the receipt said "About 57 seconds left." over its row's "56 s left",
 *  two 1 s timers out of step): the wait to the next tick, landing just after a wall-clock second, so the receipt and the
 *  Jobs row count the same end at the same moment and say the same figure. `every`: the clock's own pace (1 s, 15 s). */
export const onSecond = (every: number, now: number): number => Math.max(5, every - (now % 1000) + 5);
/** The receipt's job as its rows say (QA's MUST, 7 Nov: never the past tense before a chain read says landed):
 *  a row of it stopped or failed: "stopped" with that row's own words ("unsure" when they say the money may be in either
 *  place, private-route unsureIn); every row ended done: "landed"; else "going". The tap's starting row counts only when
 *  it stopped (a refusal before the core answered). `own`: this job's rows (receiptRows); none, the time window. */
export type ReceiptState = { state: "going" } | { state: "landed"; at: number } | { state: "stopped" | "unsure"; words?: string };
export function receiptStateOf(list: readonly { id: string; state: string; startedAt: number; endedAt?: number; detail?: string }[], since: number, own?: (id: string) => boolean): ReceiptState {
  const mine = receiptRows(list, since, own);
  const stop = mine.find((t) => t.state === "failed" || t.state === "stopped");
  if (stop) return { state: /either in .+ or still with /.test(stop.detail ?? "") ? "unsure" : "stopped", ...(stop.detail ? { words: stop.detail } : {}) };
  const at = landedOf(list, since, own);
  return at !== undefined ? { state: "landed", at } : { state: "going" };
}
/** How far before the receipt opened its job's own row may be stamped (made at the tap, the receipt a frame later). */
export const LANDED_SLACK_MS = 5_000;

/** A card's step words never repeat a figure its title already shows (the copy review's grade of M4, 7 Nov: the Now card read "Move
 *  $119.33 to your SOL and NEAR wallets / Through NEAR Confidential · about $119.33"): a " · $X" or " · about $X" part
 *  whose figure is in the title goes; any other part stays. Every card line (TaskCentre goingLine, Home's rowLine). Pure. */
export function cardStep(label: string, title?: string): string {
  if (!title) return label;
  const [head, ...rest] = label.split(" · ");
  const kept = rest.filter((seg) => { const m = /^(?:about )?(\$[\d,]+\.\d{2})\.?$/.exec(seg.trim()); return !(m && title.includes(m[1]!)); });
  return [head, ...kept].join(" · ");
}
