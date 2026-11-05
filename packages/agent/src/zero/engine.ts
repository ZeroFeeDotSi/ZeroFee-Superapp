// AgentZero's engine: the one place its jobs, receipts and day's spending live, outside any screen. The Agent tab shows
// it; Chat's request chip asks it to pay (AZ2 job 3, "Pay my list in Chat"). The shell renders only the app on screen
// and its neighbours, so this can't live in the Agent tab's React state: a payment asked from Chat must work while the
// Agent tab isn't drawn.
//
// What it does, in order, for every action:
//   1. one at a time (a lock for the whole JS realm, so two screens, two engines or a double tap can't race);
//   2. reads what is kept on this device (device.store) and AgentZero's state on the account (account.agent.view) fresh;
//   3. decides with runner.ts (plain code, no model);
//   4. carries it out with the core (account.agent.spend: AgentZero's own key, no sheet, held on chain to its wallet
//      and the pay list), and writes one receipt.
// A Chat request is paid at most once: its id is kept with the payment before the lock is let go.
//
// Who is "you": a pay from Chat comes only from the person's tap on the request chip (from: "you"). The words of a
// message are never an order (runner.ts refuses "message" and "page"). Who gets paid is the request's own address, which
// must be on the account's pay list; the contract checks the list again.
import type { Bridge } from "@zerofee/core/bridge";
import { LIMITS, withinOr } from "../chat/wait.ts";
import type { TxOutcome } from "@zerofee/core/signer";
import { oneClickDown, type ServiceStatus } from "@zerofee/core/services";
import { AGENT_PRIVATE_ROUTE, AGENTZERO_WALLET } from "@zerofee/core/agent-route";
import { KEEP_FROM_AGENT_OFF, KEEP_FROM_AGENT_OPEN, keepReading, type KeepStatus, type KeepWallet } from "./keep-read.ts";
import { USDC_ID } from "../agent-pay.ts";
import { recipientKey } from "../check.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { judge, type CounterpartyCheck } from "./counterparty.ts";
import { HIDES_ITS_WORDS, addressHides, authorises, notAnOrder, obfuscated, textHides, unitGuard } from "../guard/guard.ts";
import { dollars, jobTitle, newJobId, type Job } from "./jobs.ts";
import { decide, room, spentBy, spentToday, trimSpent, type Action, type Event, type Spent } from "./runner.ts";
import { anchorReceipts, headAfter, keepReceipts, makeReceipt, receiptsSince, whyLines, type Receipt, type ReceiptHead } from "./receipts.ts";
import { PRICE_ASSET, RUNS_WHEN_OPEN, isDue, periodOf, routineLines, routineRun, routineScope, whenWords, type PriceCoin, type Routine, type RoutineTerms } from "./routines.ts";

/** D91: AgentZero pays only privately (through a 1Click quote the core makes); until route A is proven, nobody. */
export const PRIVATE_OFF_LINE = "AgentZero can't pay this privately yet.";
/** The receipt's and Chat's line for a payment (D91, QA's words). */
/** The core's "ask me above $X" refusal (core agent-private.ts ASK_FIRST_CODE). */
const ASK_FIRST = "security.agent.ask-first";
export const UNKNOWN_LINE = "Not sure it went. Check Activity before you pay again.";
export const TOP_UP_OFF_LINE = "AgentZero can't fill your SOL wallet privately yet. Nothing moved.";
/** How often a running keep job looks at Spending while ZeroFee is open. */
export const TICK_MS = 30_000;
/** A-6: one event on the page when a job's step ends while it may be in the background (the shell turns it into the
 *  phone's local notification). Its kind only: never an amount, an address, a coin or a name. */
export const JOB_DONE_EVENT = "agentzero:job-done";
export type JobDoneKind = "trade-done" | "job-stopped" | "needs-you";
export const emitJobDone = (kind: JobDoneKind): void => {
  try {
    const g = globalThis as { dispatchEvent?: (e: unknown) => boolean; CustomEvent?: new (t: string, i: { detail: unknown }) => unknown };
    if (typeof g.dispatchEvent === "function" && typeof g.CustomEvent === "function") g.dispatchEvent(new g.CustomEvent(JOB_DONE_EVENT, { detail: { kind } }));
  } catch {
    // A listener's fault never reaches the money path.
  }
};
/** A top-up counts as on its way to Spending this long after it was sent (1Click's private move: 20 s to a few minutes). */
export const ON_ITS_WAY_MS = 10 * 60_000;
/** Privacy audit (4 Nov): AgentZero's money starts public (its key pays from the account into 1Click), and the payee's end
 *  is public a moment later, so only the middle is hidden; never "your account isn't on the public chain". */
export const paidLine = (usd: number, to: string) => `Paid ${dollars(usd)} to ${to}. Only the middle of the payment is hidden.`;

export const KEYS = { jobs: "agentzero.jobs", receipts: "agentzero.receipts", spent: "agentzero.spent", requests: "agentzero.chat-paid", seen: "agentzero.paid-to", routines: "agentzero.routines" } as const;

/** AgentZero's state on the account, in dollars (USDC 1:1; its budget is USDC only, budget.ts). */
export interface ZeroState {
  limitUsd: number;
  spentUsd: number;
  sample: boolean;
  /** The people the account lets AgentZero's key pay (budget.recipients). */
  people: string[];
  endsAtNs?: string;
}

/** The core's view (release 10's `agent`), or the sample core's. Null when AgentZero isn't on the account. */
export function zeroState(view: unknown): ZeroState | null {
  if (!view || typeof view !== "object") return null;
  const v = view as { limitUsd?: number; spentTodayUsd?: string; sample?: boolean; people?: string[]; budget?: { coins?: { coin: string; per_day: string }[]; recipients?: string[]; ends_at_ns?: string }; spent?: [string, string, string][] };
  if (typeof v.limitUsd === "number") return { limitUsd: v.limitUsd, spentUsd: Number(v.spentTodayUsd ?? 0) || 0, sample: v.sample === true, people: Array.isArray(v.people) ? v.people.map(recipientKey) : [] };
  const limit = (v.budget?.coins ?? []).find((c) => c.coin === USDC_ID);
  const spent = (v.spent ?? []).filter(([c]) => c === USDC_ID).reduce((t, [, day]) => t + Number(day) / 1e6, 0);
  return { limitUsd: limit ? Number(limit.per_day) / 1e6 : 0, spentUsd: spent, sample: false, people: Array.isArray(v.budget?.recipients) ? v.budget.recipients.map(recipientKey) : [], ...(v.budget?.ends_at_ns ? { endsAtNs: v.budget.ends_at_ns } : {}) };
}

/** A Chat request this device paid through AgentZero (or is paying): by the request's message id. */
export interface PaidRequest {
  atIso: string;
  txHash?: string;
  usd: number;
  /** "paying": sent to the core, no answer yet; "unknown": the core couldn't say it went (security review M3). Either
   *  way the chip never offers Pay again for it: the person checks Activity. No recipient is kept (review L1). */
  state?: "paying" | "unknown";
}

export interface Snapshot {
  jobs: Job[];
  receipts: Receipt[];
  spent: Spent[];
  state: ZeroState | null;
  /** True once the device's store was read. */
  loaded: boolean;
  /** A-2: the person's routines in plain words. */
  routines?: Routine[];
}

/** What Chat's chip shows before a tap: AgentZero can pay this, or the line why not (the chip then offers plain Send). */
/** `warn`: the counterparty check's reason, shown on the chip before the tap (the tap is the person's answer to it). */
export type Offer = { ok: true; line: string; warn?: string } | { ok: false; line: string };

/** The answer to a tap on the chip. */
export type PayAnswer =
  | { kind: "paid"; line: string; txHash?: string }
  /** This request was paid before, on this device: never twice. */
  | { kind: "already"; line: string; txHash?: string }
  /** It was sent but the core couldn't say it went: never offered again; check Activity (review M3). */
  | { kind: "unknown"; line: string }
  /** AgentZero doesn't do this one (off, no list job, not on the list, over today's room): nothing tried. */
  | { kind: "not-here"; line: string }
  /** It tried and the account (or the check) said no: nothing moved. */
  | { kind: "refused"; line: string };

export interface ChatAsk {
  /** The request's message id in Chat (kept so it is paid once). */
  requestId: string;
  /** Who gets paid: the request's own NEAR address. */
  to: string;
  /** Dollars: the request's USDC amount. */
  usd: number;
}

export interface ZeroEngine {
  /** Resolves once every pocket trade under way has ended and written its receipt. */
  settled(): Promise<void>;
  snapshot(): Snapshot;
  /** Read the device's store and the account again; listeners hear the result. */
  refresh(): Promise<Snapshot>;
  subscribe(fn: (s: Snapshot) => void): () => void;
  /** The Agent tab's own changes: the jobs list (start, stop) and a receipt for them. */
  saveJobs(next: (jobs: Job[]) => Job[]): Promise<void>;
  addReceipts(more: Receipt[]): Promise<void>;
  /** One event for its job: decide, then carry out (the runner's tick, the rule box's Pay, a site step). */
  handle(ev: Event): Promise<Action | null>;
  /** Each running keep job looks at Spending now (and every TICK_MS once start() ran). */
  tick(): Promise<void>;
  /** Start looking every TICK_MS while ZeroFee is open (once per engine; the Agent tab calls it). */
  start(): void;
  /** Each running copy job on a real account looks at its copied wallet once (P4; start() repeats it every POLL_MS). */
  watchOnce(): Promise<number>;
  /** Chat's chip: can AgentZero pay this request? Reads only; nothing moves. */
  offer(ask: Omit<ChatAsk, "requestId"> & { requestId?: string }): Promise<Offer>;
  /** Chat's chip, tapped: pay this request through AgentZero, once. `tap`: the click event on the chip (M2). */
  payRequest(ask: ChatAsk, tap: unknown): Promise<PayAnswer>;
  /** D117: one act on the person's rows or Hidden, inside the job's approved scope (the core's account.agent.act). Only
   *  the person's words or a job they started may ask (`source`); nothing read is an order. Always one receipt. */
  act(ask: ActAsk): Promise<{ ok: boolean; line: string }>;
  /** A-2: start a routine the person approved on its sheet. A moving one asks the core's act-scope sheet first (one
   *  Face ID); a price one reads its starting price. One receipt. */
  startRoutine(t: RoutineTerms): Promise<{ ok: boolean; line: string }>;
  /** Stops a routine at once. One receipt. */
  stopRoutine(id: string): Promise<void>;
  /** A chat ask AgentZero said no to (over its limit, hidden words, a payee it couldn't read): one refused receipt, on
   *  the chained log with the rest (real-Claude walk, 3 Nov: the chat's refusals left no receipt). Nothing moves. */
  refused(line: string, asked: string): Promise<void>;
  /** Runs every due routine once (the tick does this while ZeroFee is open). Returns how many ran. */
  runRoutines(): Promise<number>;
}

/** One act AgentZero was asked to do (D117). `usd`: its worth in dollars; `key`: its own id, so asking again is safe. */
export interface ActAsk {
  kind: "send" | "swap" | "move" | "pay" | "trade";
  from: string;
  to?: string;
  usd: number;
  key: string;
  source: unknown;
  /** The words that asked, for the guard (hidden words are refused). */
  words?: string;
  coin?: string;
  side?: "buy" | "sell";
  /** A coin's name for the receipt (trade). */
  name?: string;
}

// ── one at a time, for the whole realm ──
let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

const parse = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    return (Array.isArray(fallback) ? (Array.isArray(v) ? v : fallback) : v && typeof v === "object" && !Array.isArray(v) ? v : fallback) as T;
  } catch {
    return fallback;
  }
};

/** Most Chat requests kept as paid; the oldest go first. */
const KEEP_PAID = 300;
const AMOUNT = /^\d{1,7}(?:\.\d{1,6})?$/;

/** A request's dollars, from its USDC amount text ("5", "2.50"): null if it isn't a plain amount above $0.01. */
export function requestUsd(amount: string, coin: string): number | null {
  if (coin.trim().toUpperCase() !== "USDC" || !AMOUNT.test(amount.trim())) return null;
  const n = Number(amount);
  return n >= 0.01 ? Math.round(n * 1e6) / 1e6 : null;
}

/**
 * Proof that a payment was the person's own tap (security review M2), checked before AgentZero pays from Chat's chip or
 * the Agent tab's Pay: a real browser event (its native getters refuse anything else, so a plain object that says
 * isTrusted can't pass), marked trusted by the browser (script-made events never are), a click or pointer-up under 2 s
 * old, used once, whose target sits inside the element marked data-agentzero-pay="<that request's id>".
 * Limit (stated in the README's security notes): code in the same page could still lay an invisible chip over a real
 * one and catch a real tap; a native tap proof is the later fix.
 */
export type TapCheck = (tap: unknown, requestId: string) => boolean;
const tapsUsed = new WeakSet<object>();
const TAP_MS = 2_000;
// Taken when this module loads, so code that patches Event's or Element's prototype later can't fool the check (review).
const eventGetter = (name: string) => (typeof Event === "undefined" ? undefined : Object.getOwnPropertyDescriptor(Event.prototype, name)?.get);
const NATIVE = {
  type: eventGetter("type"),
  timeStamp: eventGetter("timeStamp"),
  target: eventGetter("target"),
  now: typeof performance === "undefined" ? undefined : performance.now.bind(performance),
  closest: typeof Element === "undefined" ? undefined : Element.prototype.closest,
  getAttribute: typeof Element === "undefined" ? undefined : Element.prototype.getAttribute,
};
/** A trusted tap whose target sits inside the element whose `attr` is `value` (personTap's checks, any marked element). */
export const trustedTap = (attr: string): TapCheck => (tap, requestId) => {
  const { type: typeOf, timeStamp, target: targetOf, now, closest, getAttribute } = NATIVE;
  if (!typeOf || !timeStamp || !targetOf || !now || !closest || !getAttribute || !tap || typeof tap !== "object") return false;
  let type: unknown, at: unknown, target: unknown;
  try {
    // Brand checks: these native getters throw for anything that isn't a real Event.
    type = typeOf.call(tap);
    at = timeStamp.call(tap);
    target = targetOf.call(tap);
  } catch {
    return false;
  }
  // isTrusted is each real event's own, unforgeable property: script-made events are never trusted.
  if ((tap as { isTrusted?: unknown }).isTrusted !== true) return false;
  if (type !== "click" && type !== "pointerup") return false;
  const t = now();
  if (typeof at !== "number" || t - at > TAP_MS || t < at) return false;
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const chip = closest.call(target, `[${attr}]`);
  if (!chip || getAttribute.call(chip, attr) !== requestId) return false;
  if (tapsUsed.has(tap)) return false;
  tapsUsed.add(tap);
  return true;
};
export const personTap: TapCheck = trustedTap("data-agentzero-pay");
export const TAP_LINE = "Tap Pay on the request to pay it.";

const made = new WeakMap<Bridge, ZeroEngine>();

/** The engine for this bridge (the agent app's own: appBridge("agent")). One per bridge, so every screen shares it. */
/** `route`: tests only, the private route as if the test proof had passed (the app always reads AGENT_PRIVATE_ROUTE). */
/** AgentZero's hands for its pocket's trades (P3's pocket-trade.ts): Trade's Solana engine on the pocket's address. */
export interface PocketHands {
  /** `ticket`: an act's (D117), so the core charges that job at its own value before signing. */
  /** `pumpOnly`: a copy buy, on pump.fun's own route only (never an aggregator route chosen from the leader's signal). */
  buy(mint: string, usd: number, name: string, ticket?: string, o?: { pumpOnly?: boolean }): Promise<PocketResult>;
  sellAll(mint: string, name: string, ticket?: string): Promise<PocketResult>;
}
export type PocketResult =
  | { kind: "done"; line: string; txHash: string; ms: { signed: number; landed: number } }
  | { kind: "unknown"; line: string; txHash: string; ms: { signed: number } }
  | { kind: "refused"; line: string }
  | { kind: "failed"; line: string; txHash: string };
/** A copy job's watch on the copied wallet (copy-watch.ts). */
export interface LeaderWatch {
  look(): Promise<{ events: Event[]; line?: string }>;
  waitMs(): number;
}

/** The real hands and watch (copy-run.ts): Trade's code loads only when a copy job runs on a real account, through one
 *  lazy import (Home's first load). */
const realHands = (bridge: Bridge) => import("./copy-run.ts").then((m) => m.realHands(bridge));
const realWatch = (job: Job) => import("./copy-run.ts").then((m) => m.realWatch(job));

/** The receipt's timings (P4): the copied wallet's trade → AgentZero's decision → signed → landed. */
export function latencyLine(blockTimeMs: number | undefined, decidedAtMs: number, ms: { signed: number; landed?: number }): string {
  const s = (n: number) => `${(Math.max(0, n) / 1000).toFixed(1)} s`;
  const seen = blockTimeMs ? `${s(decidedAtMs - blockTimeMs)} after the copied wallet, ` : "";
  return `Speed: ${seen}signed in ${s(ms.signed)}${ms.landed !== undefined ? `, landed in ${s(ms.landed)}` : ""}.`;
}

export function zeroEngine(bridge: Bridge, opts: { now?: () => number; tapCheck?: TapCheck; route?: boolean; wallet?: boolean; hands?: () => Promise<PocketHands>; watch?: (job: Job) => Promise<LeaderWatch | null>; jobDone?: (kind: JobDoneKind) => void } = {}): ZeroEngine {
  const had = made.get(bridge);
  if (had) return had;
  const now = opts.now ?? Date.now;
  const isTap = opts.tapCheck ?? personTap;
  const jobDone = opts.jobDone ?? emitJobDone;
  /** What each request's chip offered (to, dollars), so a tap pays only that (review M2: the id alone bound nothing). */
  const offered = new Map<string, { to: string; usd: number; atMs: number; verdict: CounterpartyCheck["verdict"] }>();
  const OFFER_MS = 15 * 60_000;
  const routeOpen = opts.route ?? AGENT_PRIVATE_ROUTE;
  /** AgentZero's own wallet (L8): its keep jobs read and fill the person's chosen wallet, from AgentZero's wallet only. */
  const walletOn = opts.wallet ?? AGENTZERO_WALLET;
  let snap: Snapshot = { jobs: [], receipts: [], spent: [], state: null, loaded: false };
  const listeners = new Set<(s: Snapshot) => void>();
  const tell = () => {
    for (const l of listeners) l(snap);
  };

  const get = async (key: string): Promise<unknown> => {
    const r = await bridge.call<{ value: string | null }>("device.store.get", { key });
    return "ok" in r ? r.ok?.value : null;
  };
  const put = async (key: string, value: unknown) => void (await bridge.call("device.store.set", { key, value: JSON.stringify(value) }));

  /** The device's store and the account, read fresh (inside the lock when it moves money). */
  const load = async (): Promise<Snapshot> => {
    // wait.ts: the account's view within 3/4 of the core's limit (inside a tool's own; late reads as "couldn't be read": the last state is kept), so
    // a slow NEAR never holds the engine's lock forever. The device's own store is read as before.
    const viewRead = withinOr(bridge.call("account.agent.view"), LIMITS.core * 0.75, "NEAR", { problem: { code: "timeout" } } as never);
    const [view, j, r, s, rt, h] = await Promise.all([viewRead, get(KEYS.jobs), get(KEYS.receipts), get(KEYS.spent), get(KEYS.routines), readHead()]);
    // The receipts' chain head, kept apart in the core's vault (audit): undefined when the core didn't answer (the last stays).
    if (h !== undefined) head = h;
    snap = {
      jobs: parse<Job[]>(j, []),
      receipts: parse<Receipt[]>(r, []),
      spent: trimSpent(parse<Spent[]>(s, []), now()),
      // A view that couldn't be read keeps the last one seen (never "off" because NEAR was slow).
      state: "ok" in view ? zeroState(view.ok) : snap.state,
      loaded: true,
      routines: parse<Routine[]>(rt, []),
    };
    anchorReceipts(snap.receipts, head);
    return snap;
  };

  /** The receipts' chain head as the core's vault keeps it (null: none yet; undefined: not read). */
  let head: ReceiptHead | null | undefined;
  /** The core's head, or undefined when it didn't answer (a throw or a problem). */
  function readHead(): Promise<ReceiptHead | null | undefined> {
    return bridge.call<{ head: ReceiptHead | null }>("account.agent.receiptHead", {}).then((x) => ("ok" in x ? x.ok?.head ?? null : undefined), () => undefined);
  }
  const writeReceipts = async (more: Receipt[]) => {
    const next = keepReceipts(more, snap.receipts);
    // Re-review: the head isn't known (its read failed): read it again; still unknown, the head isn't saved this time
    // (saving without it would look like a break); the next write tries again and catches up.
    if (head === undefined) {
      const h = await readHead();
      if (h !== undefined) head = h;
    }
    const known = head !== undefined;
    const moved = known ? headAfter(snap.receipts, head, more.length, next) : null;
    snap = { ...snap, receipts: next };
    await put(KEYS.receipts, next);
    if (!moved) return;
    // The head after the list, with the receipts since the last head (the core's continuity check). A head that didn't
    // save leaves the last one in place (still in the list, so nothing reads as changed); the next write catches up.
    const r = await bridge.call<{ head: ReceiptHead | null }>("account.agent.receiptHead", { set: moved, since: receiptsSince(next, head) }).catch(() => null);
    if (r && "ok" in r) head = r.ok?.head ?? moved;
    anchorReceipts(next, head);
  };
  const writeRoutines = async (next: Routine[]) => {
    snap = { ...snap, routines: next };
    await put(KEYS.routines, next);
  };
  /** A coin's price in dollars for a price routine, from the ledger's own list; null when it can't be read. */
  const priceOf = async (coin: PriceCoin): Promise<number | null> => {
    const r = await bridge.call<{ assetId: string; priceUsd?: string | number }[]>("ledger.tokens", {});
    const p = "ok" in r && Array.isArray(r.ok) ? Number(r.ok.find((t) => t.assetId === PRICE_ASSET[coin])?.priceUsd) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  };
  const writeJobs = async (next: Job[]) => {
    snap = { ...snap, jobs: next };
    await put(KEYS.jobs, next);
  };

  /** Today's room counts what the account says was spent too (another device, a reinstall), whichever is more. */
  const ledger = () => {
    const pocket = snap.state?.limitUsd ?? 0;
    const device = spentToday({ nowMs: now(), pocketUsd: pocket, spent: snap.spent });
    const chain = snap.state?.spentUsd ?? 0;
    const extra: Spent[] = chain > device ? [{ atMs: now(), jobId: "", usd: chain - device }] : [];
    return { nowMs: now(), pocketUsd: pocket, spent: [...snap.spent, ...extra] };
  };

  /**
   * Whom AgentZero has paid from here, and the code each ran then (for "its code changed since you last paid it"). Kept by
   * a hash of the account, never the account itself (review L1: the device keeps no list of whom you paid).
   */
  type Seen = Record<string, { code: string | null; atIso: string }>;
  const seenKey = (who: string) => bytesToHex(sha256(utf8ToBytes(`zerofee-agentzero-paid:${who}`)));
  /** The account on NEAR, read at most once per 2 minutes per account (review: three reads per payment linked this
   *  device to the recipient at the moment of a private payment). */
  const infoKept = new Map<string, { atMs: number; value: { exists: boolean; code: string | null } | null }>();
  const accountOf = async (who: string, fresh = false) => {
    const had = infoKept.get(who);
    if (!fresh && had && now() - had.atMs < 120_000) return had.value;
    const r = await bridge.call<{ exists: boolean; code: string | null }>("ledger.recipientInfo", { accountId: who });
    const value = "ok" in r && r.ok && typeof r.ok.exists === "boolean" ? { exists: r.ok.exists, code: typeof r.ok.code === "string" ? r.ok.code : null } : null;
    if (value) infoKept.set(who, { atMs: now(), value });
    if (infoKept.size > 200) infoKept.delete(infoKept.keys().next().value!);
    return value;
  };
  /** The counterparty check's facts: the account on NEAR (two nodes), and only this device's own paid-to record. */
  const counterparty = async (to: string): Promise<CounterpartyCheck> => {
    const who = recipientKey(to);
    const [account, seenRaw] = await Promise.all([accountOf(who), get(KEYS.seen)]);
    const mine = parse<Seen>(seenRaw, {})[seenKey(who)];
    return judge(who, { account, paidBefore: !!mine, ...(mine ? { codeWhenPaid: mine.code } : {}) });
  };
  const notePaid = async (to: string) => {
    const seen = parse<Seen>(await get(KEYS.seen), {});
    const who = recipientKey(to);
    const account = await accountOf(who);
    // Only a code read (now or within 2 min) is kept; a failed read keeps what was there; the newest 500.
    if (account) seen[seenKey(who)] = { code: account.code, atIso: new Date(now()).toISOString() };
    await put(KEYS.seen, Object.fromEntries(Object.entries(seen).sort((x, y) => y[1].atIso.localeCompare(x[1].atIso)).slice(0, 500)));
  };
  const RANK = { allow: 0, warn: 1, block: 2 } as const;

  /** Carry out one action with the core, then its receipt. Must run inside the lock, after load(). */
  let handsP: Promise<PocketHands> | null = null;
  /** Pocket trades signed or on their way, outside the lock (each writes its own receipt when it ends). */
  const inFlight = new Set<Promise<void>>();
  const carryOut = async (job: Job, a: Action, why?: string[], blockTimeMs?: number): Promise<{ receipt: Receipt; txHash?: string; refused?: string; unknown?: boolean }> => {
    const at = now();
    const pocket = snap.state?.limitUsd ?? 0;
    const jobLine = `Job: ${jobTitle(job.kind)}.`;
    if (a.kind === "skip" || a.kind === "note") {
      const receipt = makeReceipt(a, at, [jobLine, ...(why ?? []), a.line]);
      await writeReceipts([receipt]);
      return { receipt, ...(a.kind === "skip" ? { refused: a.line } : {}) };
    }
    let check: Receipt["check"];
    let who: CounterpartyCheck | null = null;
    // The guard (item 11), before any key: a payee that hides its words, or dollars its own units don't add up to.
    if (a.kind === "pay" || a.kind === "top-up") {
      const stop = a.kind === "pay" && (obfuscated(a.to) || addressHides(a.to)) ? HIDES_ITS_WORDS : unitGuard({ askedUsd: a.usd, decimals: 6, rawAmount: String(Math.round(a.usd * 1e6)), priceUsd: 1 });
      if (stop) {
        const receipt = makeReceipt({ kind: "skip", jobId: job.id, line: stop }, at, [jobLine, ...(why ?? []), stop, "Nothing was sent."]);
        await writeReceipts([receipt]);
        return { receipt, refused: stop };
      }
    }
    if (a.kind === "pay") {
      // The counterparty check (security track): block refuses with its reason; a warning was on the chip the person
      // tapped (or the tab's Pay sheet), so their tap answers it; every reason goes on the receipt's Why.
      who = await counterparty(a.to);
      check = { verdict: who.verdict, line: who.line, by: "phone" };
      if (who.verdict === "block") {
        const line = `Refused. ${who.line}`;
        const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, ...who.reasons, "Nothing was sent."], { check });
        await writeReceipts([receipt]);
        return { receipt, refused: line };
      }
    }
    // D91: a real payment goes only through the core's private path, shut until route A is proven. Said, never tried
    // (a refusal from the core would stop the job).
    if (a.kind === "pay" && !snap.state?.sample && !routeOpen) {
      const line = `${PRIVATE_OFF_LINE} Nothing was sent.`;
      const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, ...(why ?? []), line]);
      await writeReceipts([receipt]);
      return { receipt, refused: line };
    }
    // What the core can do with AgentZero's key on a real account today: pay a listed person privately. A move into
    // Spending and a trade on pump.fun run on the web demo's sample money only; on a real account they say so.
    // A top-up into Spending (D89) goes through the same private path; while it's shut the keep job stops with one
    // receipt (it would otherwise say so every tick).
    // L8: with AgentZero's own wallet on, a keep job fills the person's wallet from AgentZero's wallet only; that route
    // isn't built (keep-read.ts keepRuns), so no keep job is offered there; one saved before stops with one plain receipt
    // (never agent_pay from the account, never a top-up of the NEAR wallet).
    if (a.kind === "top-up" && !snap.state?.sample && walletOn && !KEEP_FROM_AGENT_OPEN) {
      const line = KEEP_FROM_AGENT_OFF((job as { wallet?: KeepWallet }).wallet ?? "sol");
      await writeJobs(snap.jobs.map((j) => (j.id === job.id ? { ...j, on: false } : j)));
      const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, line, "AgentZero stopped this job."]);
      await writeReceipts([receipt]);
      jobDone("job-stopped");
      return { receipt, refused: line };
    }
    if (a.kind === "top-up" && !snap.state?.sample && !routeOpen) {
      const line = TOP_UP_OFF_LINE;
      await writeJobs(snap.jobs.map((j) => (j.id === job.id ? { ...j, on: false } : j)));
      const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, line, "AgentZero stopped this job. It starts again once private top-ups are ready."]);
      await writeReceipts([receipt]);
      jobDone("job-stopped");
      return { receipt, refused: line };
    }
    // A copy job on a real account (P3/P4): AgentZero's own pocket, inside the day the person approved with Face ID.
    // The core refuses by name without one ("Open ZeroFee and approve today."). A refusal never stops the job: the next
    // trade may be fine (a coin Trade won't offer, one day not yet approved).
    if (!snap.state?.sample && (a.kind === "buy" || a.kind === "sell")) {
      const hands = await (handsP ??= (opts.hands ?? (() => realHands(bridge)))().catch((e: unknown) => {
        handsP = null;
        throw e;
      })).catch(() => null);
      // Decided and counted here, inside the lock: the buy's dollars go on the ledger now (provisionally), so the next
      // leader event is decided with them. The trade itself (sign, send, wait to land: up to a minute) runs OUTSIDE the
      // lock, so Chat's payments never wait behind it; the pocket trader keeps its own trades in order and the core
      // counts each before signing. Its receipt, and the ledger's correction if it didn't go, come back inside the lock.
      const add = spentBy(a, at);
      if (add) {
        const nextSpent = trimSpent([...snap.spent, add], at);
        snap = { ...snap, spent: nextSpent };
        await put(KEYS.spent, nextSpent);
      }
      const trade: Promise<PocketResult> = (
        !hands
          ? Promise.resolve<PocketResult>({ kind: "refused", line: "AgentZero's trading didn't load. Nothing moved." })
          : a.kind === "buy"
            ? hands.buy(a.mint, a.usd, a.symbol, undefined, { pumpOnly: job.kind === "copy" })
            : hands.sellAll(a.mint, a.symbol)
      ).catch((): PocketResult => ({ kind: "refused", line: "AgentZero's trading didn't answer. Nothing moved." }));
      const settled = trade.then((r) =>
        serial(async () => {
          await load();
          if (r.kind !== "done" && add) {
            // It didn't go: take its provisional dollars off the ledger again (the one entry this trade put there).
            const i = snap.spent.findIndex((x) => x.atMs === add.atMs && x.jobId === add.jobId && x.usd === add.usd);
            if (i >= 0) {
              const nextSpent = [...snap.spent.slice(0, i), ...snap.spent.slice(i + 1)];
              snap = { ...snap, spent: nextSpent };
              await put(KEYS.spent, nextSpent);
            }
          }
          const speed = "ms" in r ? [latencyLine(blockTimeMs, at, r.ms)] : [];
          const receipt =
            r.kind === "done"
              ? makeReceipt(a, at, [jobLine, ...(why ?? []), r.line, ...speed], { txHash: r.txHash })
              : makeReceipt({ kind: "skip", jobId: job.id, line: r.line }, at, [jobLine, ...(why ?? []), r.line, ...speed], "txHash" in r ? { txHash: r.txHash } : {});
          await writeReceipts([receipt]);
          tell();
          if (r.kind === "done") jobDone("trade-done");
        }),
      );
      inFlight.add(settled);
      void settled.finally(() => inFlight.delete(settled)).catch(() => undefined);
      return { receipt: makeReceipt({ kind: "note", jobId: job.id, line: "On its way." }, at, [jobLine]) };
    }
    if (!snap.state?.sample && a.kind !== "pay" && a.kind !== "top-up") {
      const line = "AgentZero can't trade on pump.fun yet. Nothing moved.";
      const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, line]);
      await writeReceipts([receipt]);
      return { receipt, refused: line };
    }
    const params =
      a.kind === "pay"
        ? { kind: "pay-private", usd: a.usd, to: a.to, title: `AgentZero paid ${dollars(a.usd)} to ${a.to}`, payout: { Ledger: { token_id: USDC_ID } }, amount: String(Math.round(a.usd * 1e6)) }
        : a.kind === "top-up"
          ? // The core picks where it goes (Spending's private balance, through its own 1Click quote): never an address from here.
            { kind: "top-up", usd: a.usd, title: makeReceipt(a, at, []).title, amount: String(Math.round(a.usd * 1e6)) }
          : { kind: a.kind, usd: a.usd, title: makeReceipt(a, at, []).title, ...(a.kind === "buy" || a.kind === "sell" ? { coin: a.symbol } : {}) };
    const r = await bridge.call<TxOutcome>("account.agent.spend", params);
    if ("problem" in r || r.ok.status !== "done") {
      const p = "problem" in r ? r.problem : r.ok.status === "problem" ? r.ok.problem : null;
      // The core's refusals for AgentZero carry the person's reason in `more` ("AgentZero pays only the people on your
      // list."); its general line ("This app asked for something it isn't allowed") would blame the wrong thing.
      const said = p ? ((p.code === "security.request.not-allowed" || p.code === ASK_FIRST) && typeof p.more === "string" && p.more ? p.more : p.whatHappened) : null;
      // Over the person's "ask me above" amount: not a fault, so the job keeps running and the person pays this one.
      if (p?.code === ASK_FIRST) {
        const line = `${said} Nothing was sent.`;
        const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, ...(why ?? []), line]);
        await writeReceipts([receipt]);
        jobDone("needs-you");
        return { receipt, refused: line };
      }
      // Refused before anything was signed (the core said no) is "Didn't move". Signed and sent but not confirmed (a slow
      // node, the contract's own refusal) can't be told apart here: it is "not sure", never "didn't move" (review M3).
      const sent = !("problem" in r);
      const line = sent ? UNKNOWN_LINE : said ? `Didn't move: ${said}` : "Didn't move. Nothing was sent.";
      // The account said no: the job stops, so a refused payment isn't tried again and again (each try costs a network
      // fee from AgentZero's allowance; security design review M1). The person starts it again.
      await writeJobs(snap.jobs.map((j) => (j.id === job.id ? { ...j, on: false } : j)));
      const receipt = makeReceipt({ kind: "skip", jobId: job.id, line }, at, [jobLine, ...(why ?? []), line, "AgentZero stopped this job. Start it again when you're ready."]);
      await writeReceipts([receipt]);
      jobDone("job-stopped");
      return { receipt, refused: line, ...(sent ? { unknown: true } : {}) };
    }
    const txHash = r.ok.txHash;
    const add = spentBy(a, at);
    const nextSpent = trimSpent(add ? [...snap.spent, add] : snap.spent, at);
    snap = { ...snap, spent: nextSpent };
    await put(KEYS.spent, nextSpent);
    const day = Math.max(spentToday({ nowMs: at, pocketUsd: pocket, spent: nextSpent }), (snap.state?.spentUsd ?? 0) + (add?.usd ?? 0));
    const receipt = makeReceipt(a, at, [...whyLines(a, job, day, pocket), ...(why ?? []), ...(who && who.verdict === "warn" ? who.reasons.map((r) => `Checked first: ${r}`) : [])], { ...(txHash ? { txHash } : {}), ...(check ? { check } : {}) });
    await writeReceipts([receipt]);
    if (a.kind === "pay") await notePaid(a.to);
    if (a.kind === "buy" || a.kind === "sell") jobDone("trade-done");
    return { receipt, ...(txHash ? { txHash } : {}) };
  };

  /** The running pay-list job, if any, and why AgentZero can't pay `to` now (null: it can). */
  const payable = (to: string, usd: number): { job?: Job; why: string | null } => {
    const job = snap.jobs.find((j) => j.kind === "pay-list" && j.on) as Job | undefined;
    const st = snap.state;
    if (!st || !(st.limitUsd > 0)) return { why: "AgentZero is off." };
    if (!st.sample && !routeOpen) return { why: PRIVATE_OFF_LINE };
    if (!job || job.kind !== "pay-list") return { why: "AgentZero has no pay list running." };
    const who = recipientKey(to);
    if (!job.people.includes(who) || !st.people.includes(who)) return { job, why: `${who} isn't on AgentZero's list.` };
    if (room(job, ledger(), usd) < usd) return { job, why: `${dollars(usd)} is more than AgentZero has left today.` };
    return { job, why: null };
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  /** One event for its job, inside the lock and after load(): decide, carry out, receipt. */
  const handleNow = async (ev: Event): Promise<Action | null> => {
    const job = snap.jobs.find((j) => j.id === ev.jobId);
    if (!job) return null;
    const a = decide(job, ev, ledger());
    // A note that changes nothing ("Spending has $24. Nothing to do.") is not a receipt.
    if (!(a.kind === "note" && ev.kind !== "site-step")) await carryOut(job, a, undefined, "blockTimeMs" in ev ? ev.blockTimeMs : undefined);
    return a;
  };

  /** The keep jobs look at Spending: all of it inside the lock, so two ticks at once can't both top up. */
  const tick = () => runRoutines().catch(() => 0).then(() => keepTick());
  const keepTick = () =>
    serial(async () => {
      await load();
      // Only a keep job looks, and only when it can act: sample money, or the private route open. Nothing polls otherwise.
      const keep = snap.jobs.filter((j) => j.on && j.kind === "keep");
      if (!keep.length || !(snap.state?.sample || routeOpen || walletOn)) return tell();
      const s = await bridge.call<KeepStatus & { loaded: boolean; unread?: boolean; capUsd?: string }>("spending.status", {});
      // A read that failed, or not yet loaded, is no reading: never "Spending is $0" because NEAR was slow.
      if (!("ok" in s) || !s.ok.loaded || s.ok.unread) return tell();
      // A top-up takes 20 s to a few minutes to land, and Spending's balance shows it only then: this job's own top-ups
      // of the last ON_ITS_WAY_MS count as there already (read after the lock, so a tick that just sent one is counted),
      // so a lagging read never tops up again. Past that, one that never landed (a refund) is short again and topped up.
      for (const j of keep) {
        const onItsWay = snap.spent.filter((x) => x.jobId === j.id && now() - x.atMs < ON_ITS_WAY_MS).reduce((t, x) => t + x.usd, 0);
        const cap = Number(s.ok.capUsd);
        // What the job's words name (L8): its own wallet's cash with AgentZero's wallet on; Spending's total before.
        const read = keepReading(s.ok, (j as { wallet?: KeepWallet }).wallet, walletOn);
        if (read === null) continue;
        await handleNow({ kind: "spending", jobId: j.id, usd: read + onItsWay, ...(cap > 0 ? { capUsd: cap } : {}) });
      }
      tell();
    });

  /** P4: one watch per running copy job on a real account; "Solana didn't answer." once per outage, not every look. */
  const watches = new Map<string, LeaderWatch | null>();
  const down = new Set<string>();
  const watchOnce = async (): Promise<number> => {
    await serial(load);
    if (snap.state?.sample) return 5_000;
    let next = 5_000;
    for (const job of snap.jobs.filter((j) => j.kind === "copy" && j.on)) {
      if (!watches.has(job.id)) watches.set(job.id, await (opts.watch ?? realWatch)(job).catch(() => null));
      const w = watches.get(job.id);
      if (!w) continue;
      const seen = await w.look();
      next = Math.min(next, w.waitMs());
      if (seen.line) {
        if (!down.has(job.id)) {
          down.add(job.id);
          await engine.addReceipts([makeReceipt({ kind: "note", jobId: job.id, line: seen.line }, now(), [`Job: ${jobTitle(job.kind)}.`, seen.line, "AgentZero looks again soon."])]);
        }
        continue;
      }
      down.delete(job.id);
      for (const ev of seen.events) await engine.handle(ev);
    }
    // The watch (outside the lock) waits for this look's trades to end, so it never runs ahead of its own receipts.
    await engine.settled();
    for (const id of [...watches.keys()]) if (!snap.jobs.some((j) => j.id === id && j.on)) watches.delete(id);
    return next;
  };
  let watching = false;

  /** A-2: each due routine runs once in its period. Reads happen in the lock; a move goes through act() (its own lock,
   *  the core's act door: the scope, the day's limit, never from the Safe). Marked as run first, so a failed move is said
   *  once on its receipt and never retried in a loop. */
  let routinesRunning = false;
  /** 1Click answering, by the core's own service read (ledger.status): true, false, or null when it can't be read. */
  const swapsUp = async (): Promise<boolean | null> => {
    const r = await bridge.call<ServiceStatus[]>("ledger.status", {});
    if (!("ok" in r) || !Array.isArray(r.ok)) return null;
    // "back" once the relay's own check no longer says 1Click is down (services.ts oneClickDown)
    return !oneClickDown(r.ok);
  };
  const runRoutines = async (): Promise<number> => {
    if (routinesRunning) return 0;
    routinesRunning = true;
    try {
      const list = await serial(async () => (await load(), snap.state ? (snap.routines ?? []).filter((r) => r.on) : []));
      let ran = 0;
      for (const r of list) {
        const price = "price" in r.when ? await priceOf(r.when.price).catch(() => null) : null;
        // "tell me when 1Click is back": the core's own service read (a read that fails is no answer, never "back")
        const up = "back" in r.when ? await swapsUp().catch(() => null) : null;
        const at = now();
        if (!isDue(r, at, price, up)) continue;
        let spendingUsd: number | null = null;
        if (r.do.act === "move" && r.do.aboveUsd !== undefined) {
          const st = await bridge.call<{ loaded: boolean; unread?: boolean; totalUsd: string }>("spending.status", {});
          spendingUsd = "ok" in st && st.ok.loaded && !st.ok.unread ? Number(st.ok.totalUsd) || 0 : null;
        }
        const run = routineRun(r, { spendingUsd, price });
        const period = periodOf(r.when, at);
        await serial(async () => {
          await load();
          await writeRoutines((snap.routines ?? []).map((x) => (x.id === r.id ? { ...x, ...(period ? { lastPeriod: period } : {}), ...("price" in r.when && price !== null ? { refPrice: price } : {}), ...("back" in r.when ? { on: false } : {}) } : x)));
        });
        ran++;
        if (run.kind === "move") {
          await engine.act({ kind: "move", from: "spending", to: "safe", usd: run.usd, key: `routine-${r.id}-${period ?? at}`, source: "job", words: r.words });
          continue;
        }
        await serial(async () => {
          await load();
          await writeReceipts([makeReceipt({ kind: run.kind === "skip" ? "skip" : "note", jobId: `routine-${r.id}`, line: run.line }, at, [`Your routine: "${r.words}"`, run.line, RUNS_WHEN_OPEN])]);
          tell();
        });
      }
      return ran;
    } finally {
      routinesRunning = false;
    }
  };

  const engine: ZeroEngine = {
    settled: async () => {
      while (inFlight.size) await Promise.all([...inFlight]);
    },
    tick,
    watchOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => void engine.tick().catch(() => undefined), TICK_MS);
      void engine.tick().catch(() => undefined);
      if (!watching) {
        watching = true;
        const loop = () => void watchOnce().catch(() => 5_000).then((ms) => setTimeout(loop, ms));
        loop();
      }
    },
    snapshot: () => snap,
    refresh: () =>
      serial(async () => {
        await load();
        tell();
        return snap;
      }),
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    saveJobs: (next) =>
      serial(async () => {
        await load();
        await writeJobs(next(snap.jobs));
        tell();
      }),
    addReceipts: (more) =>
      serial(async () => {
        await load();
        await writeReceipts(more);
        tell();
      }),
    handle: (ev) => {
      // A pay-ask is "you" only through payRequest (a tap on that request's own chip, M2): here it never is.
      if (ev.kind === "pay-ask" && ev.from === "you") ev = { ...ev, from: "message" };
      return serial(async () => {
        await load();
        const a = await handleNow(ev);
        tell();
        return a;
      });
    },
    offer: (ask) =>
      serial(async () => {
        await load();
        tell();
        if (ask.requestId) {
          const paid = parse<Record<string, PaidRequest>>(await get(KEYS.requests), {})[ask.requestId];
          if (paid) return { ok: false, line: paid.state ? UNKNOWN_LINE : `Paid by AgentZero · ${dollars(paid.usd)}` };
        }
        if (obfuscated(ask.to) || addressHides(ask.to)) return { ok: false, line: HIDES_ITS_WORDS };
        const { why } = payable(ask.to, ask.usd);
        if (why) return { ok: false, line: why };
        // "Ask me above $X": over it, the chip doesn't offer AgentZero; Chat's own Send (the person's sheet) stays.
        const ask1 = await bridge.call<{ askAboveUsd: number | null }>("account.agent.askAbove", {});
        const above = "ok" in ask1 ? ask1.ok.askAboveUsd : null;
        if (above !== null && ask.usd > above) return { ok: false, line: above === 0 ? "AgentZero asks you first. Pay it yourself." : `Over your $${above}. Pay it yourself.` };
        const c = await counterparty(ask.to);
        if (c.verdict === "block") return { ok: false, line: c.line };
        if (ask.requestId) {
          offered.set(ask.requestId, { to: recipientKey(ask.to), usd: ask.usd, atMs: now(), verdict: c.verdict });
          if (offered.size > 500) offered.delete(offered.keys().next().value!);
        }
        return { ok: true, line: `Pay ${dollars(ask.usd)} · AgentZero`, ...(c.verdict === "warn" ? { warn: c.line } : {}) };
      }),
    runRoutines,
    startRoutine: async (t) => {
      // A moving routine: the core's act-scope sheet first (one Face ID; on the web, D103's check), or nothing starts.
      const scope = routineScope(t);
      if (scope) {
        const r = await bridge.call<{ scope: unknown } | { declined: true }>("account.agent.actScope", { set: scope });
        if ("problem" in r) return { ok: false, line: r.problem.more ?? r.problem.whatHappened };
        if ("declined" in r.ok) return { ok: false, line: "You said no. Nothing changed." };
      }
      let refPrice: number | undefined;
      if ("price" in t.when) {
        const p = await priceOf(t.when.price).catch(() => null);
        if (p === null) return { ok: false, line: `${t.when.price}'s price couldn't be read. Nothing changed. Try again.` };
        refPrice = p;
      }
      const at = now();
      const routine: Routine = { ...t, id: `rt${newJobId(at).slice(1)}`, startedAtIso: new Date(at).toISOString(), on: true, ...(refPrice !== undefined ? { refPrice } : {}) };
      return serial(async () => {
        await load();
        await writeRoutines([...(snap.routines ?? []), routine]);
        await writeReceipts([makeReceipt({ kind: "note", jobId: `routine-${routine.id}`, line: `Routine on: ${whenWords(t.when)}.` }, at, routineLines(t))]);
        tell();
        return { ok: true, line: "Your routine is on." };
      });
    },
    stopRoutine: (id) =>
      serial(async () => {
        await load();
        const r = (snap.routines ?? []).find((x) => x.id === id);
        if (!r || !r.on) return;
        await writeRoutines((snap.routines ?? []).map((x) => (x.id === id ? { ...x, on: false } : x)));
        await writeReceipts([makeReceipt({ kind: "note", jobId: `routine-${id}`, line: "Routine stopped." }, now(), [`Your routine: "${r.words}"`, "It won't run again."])]);
        tell();
      }),
    refused: (line, asked) =>
      serial(async () => {
        await load();
        await writeReceipts([makeReceipt({ kind: "skip", jobId: "chat", line }, now(), [`You asked: "${asked.slice(0, 120)}"`, line])]);
        tell();
      }),
    act: async (a) => {
      const at = now();
      const done = (ok: boolean, line: string, why: string[] = []) =>
        serial(async () => {
          await load();
          await writeReceipts([makeReceipt({ kind: ok ? "note" : "skip", jobId: "act", line }, at, [line, ...why])]);
          tell();
          return { ok, line };
        });
      // Nothing read is an order (item 11): only the person's own words or a job they started.
      if (!authorises(a.source)) return done(false, notAnOrder(a.source));
      if (textHides(a.words) || obfuscated(a.to) || obfuscated(a.coin)) return done(false, HIDES_ITS_WORDS);
      // The core checks the job's scope and counts the act before anything is signed (one at a time, in the lock).
      const r = await serial(() => bridge.call<{ line: string; usd: number; done: unknown }>("account.agent.act", { kind: a.kind, from: a.from, to: a.to, usd: a.usd, key: a.key, coin: a.coin, side: a.side }));
      if ("problem" in r) {
        if (r.problem.code === ASK_FIRST) jobDone("needs-you");
        return done(false, `${r.problem.more ?? r.problem.whatHappened}`);
      }
      if (a.kind !== "trade") return done(true, r.ok.line, ["Inside the job you approved."]);
      // A trade: Trade's engine builds it and the trading day signs it, outside the lock (a landing can take a minute).
      const hands = await (handsP ??= (opts.hands ?? (() => realHands(bridge)))().catch((e: unknown) => {
        handsP = null;
        throw e;
      })).catch(() => null);
      if (!hands || !a.coin) return done(false, "AgentZero couldn't reach Solana's trading. Nothing was sent.");
      const ticket = (r.ok.done as { ticket?: unknown } | null)?.ticket;
      if (typeof ticket !== "string") return done(false, "That trade isn't allowed. Nothing was sent.");
      const t = a.side === "sell" ? await hands.sellAll(a.coin, a.name ?? "the coin", ticket) : await hands.buy(a.coin, a.usd, a.name ?? "the coin", ticket);
      if (t.kind === "done") jobDone("trade-done");
      return done(t.kind === "done", t.line, ["Inside the job you approved.", ...("txHash" in t && t.txHash ? [`Signed ${t.txHash.slice(0, 10)}…`] : [])]);
    },
    payRequest: (ask, tap) => {
      // Only the person's own tap on this request's chip (M2), checked NOW, before waiting for the lock (a tick ahead of
      // it must not make a real tap look old), and only for what that chip offered: the same account, the same dollars.
      const tapped = isTap(tap, ask.requestId);
      const was = offered.get(ask.requestId);
      const matches = !!was && was.to === recipientKey(ask.to) && was.usd === ask.usd && now() - was.atMs <= OFFER_MS;
      return serial(async (): Promise<PayAnswer> => {
        if (!tapped) return { kind: "not-here", line: TAP_LINE };
        // Paid (or maybe paid) before, even before a reload: say so, never "isn't what it offered".
        const kept = parse<Record<string, PaidRequest>>(await get(KEYS.requests), {})[ask.requestId];
        if (kept) return kept.state ? { kind: "unknown", line: UNKNOWN_LINE } : { kind: "already", line: `Paid by AgentZero · ${dollars(kept.usd)}`, ...(kept.txHash ? { txHash: kept.txHash } : {}) };
        if (!matches) {
          // Never offered (or something else than offered): say the real reason when there is one, never pay.
          await load();
          const { why } = payable(ask.to, ask.usd);
          if (why) return { kind: "not-here", line: why };
          const c = await counterparty(ask.to);
          return { kind: "not-here", line: c.verdict === "block" ? c.line : "That isn't what the request offered. Nothing was sent." };
        }
        await load();
        const book = parse<Record<string, PaidRequest>>(await get(KEYS.requests), {});
        const keep = async (next: Record<string, PaidRequest>) =>
          put(KEYS.requests, Object.fromEntries(Object.entries(next).sort((x, y) => y[1].atIso.localeCompare(x[1].atIso)).slice(0, KEEP_PAID)));
        const had = book[ask.requestId];
        if (had) {
          tell();
          return had.state ? { kind: "unknown", line: UNKNOWN_LINE } : { kind: "already", line: `Paid by AgentZero · ${dollars(had.usd)}`, ...(had.txHash ? { txHash: had.txHash } : {}) };
        }
        const to = recipientKey(ask.to);
        if (!(ask.usd > 0) || !Number.isFinite(ask.usd)) return { kind: "not-here", line: "There's no amount to pay." };
        const { job, why } = payable(to, ask.usd);
        if (why || !job) {
          tell();
          return { kind: "not-here", line: why ?? "AgentZero has no pay list running." };
        }
        // The check again, now: if it got worse since the chip showed it (code changed, NEAR down), the tap answered a
        // different question, so nothing is paid and the person looks again (review).
        const nowCheck = await counterparty(to);
        if (was && RANK[nowCheck.verdict] > RANK[was.verdict]) {
          tell();
          return { kind: "not-here", line: `AgentZero's check changed. ${nowCheck.line} Look at the request again.` };
        }
        // The tap on the chip is the person's own ask ("you"); the runner checks the list and the limits again.
        const a = decide(job, { kind: "pay-ask", jobId: job.id, to, usd: ask.usd, from: "you" }, ledger());
        const at = new Date(now()).toISOString();
        // Kept as "paying" BEFORE it is sent (review M3): a crash, a reload or a second screen never pays it again.
        if (a.kind === "pay") await keep({ ...book, [ask.requestId]: { atIso: at, usd: a.usd, state: "paying" } });
        const said = ask.requestId.startsWith("tab-") ? "You asked AgentZero to pay. You tapped Pay." : `${to} asked in Chat. You tapped Pay.`;
        const done = await carryOut(job, a, [said]);
        const after = parse<Record<string, PaidRequest>>(await get(KEYS.requests), {});
        if (a.kind === "pay" && !done.refused) {
          await keep({ ...after, [ask.requestId]: { atIso: at, usd: a.usd, ...(done.txHash ? { txHash: done.txHash } : {}) } });
          tell();
          return { kind: "paid", line: paidLine(a.usd, to), ...(done.txHash ? { txHash: done.txHash } : {}) };
        }
        if (a.kind === "pay" && done.unknown) {
          await keep({ ...after, [ask.requestId]: { atIso: at, usd: a.usd, state: "unknown" } });
          tell();
          return { kind: "unknown", line: UNKNOWN_LINE };
        }
        // Refused before anything was signed: nothing went, so the request may be paid later (e.g. tomorrow's room).
        if (after[ask.requestId]) {
          const { [ask.requestId]: _gone, ...rest } = after;
          await keep(rest);
        }
        tell();
        return { kind: "refused", line: done.refused ?? "Nothing was sent." };
      });
    },
  };
  made.set(bridge, engine);
  return engine;
}
