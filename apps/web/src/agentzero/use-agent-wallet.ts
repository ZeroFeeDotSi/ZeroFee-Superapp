// AgentZero's own wallet as the screen sees it (D152; D37 prepaid, 4 Nov): its plain USDC, its NEAR for sending fees,
// the month against the cap, the NEAR wallet it is filled from, the cost meter (what AgentZero used and paid today), and
// what a person can do: add money, move all to the Safe, change the limit. A message goes only when AgentZero's money
// covers it (mayAsk; the relay checks the same on chain); each reply is paid right after it in ONE transfer (the core's
// account.agent.wallet {do: "pay"}, its own figure from the reply's usage), the relay is told (POST /v0/agentzero/pay),
// and Activity gets a receipt row for it. Every money step is the core's own door and sheet; this file
// only asks, pays what is owed, and shows.
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ShellContext } from "@zerofee/shell-api/shell-context.ts";
import { replyReceipt, tasksOf, walletTask } from "./az-tasks.ts";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { fillOnTap } from "@zerofee/agent/zero/wallet-fill";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { owedOf, type ReplyOwed } from "@zerofee/agent/chat/turn";
import { CHAT_SECRETS, relayBase } from "@zerofee/agent/chat/use-chat-turn";
import { REPLY_CAP_MICROS, REPLY_HOLD_MICROS, SETTLE_AT_MICROS } from "@zerofee/core/agent-price";
import { EMPTY_BELOW_USD, LOW_BELOW_USD, fillFloor, receiptTitle } from "./wallet-words.ts";
import { METER_KEY, dayOf, heardMicros, keptPlusEarly, monthShown, readMeter, untilMidnight, type Meter } from "./meter.ts";

/** This phone ran the wallet's set-up once (the account's old AgentZero key revoked, or there was none). */
const SET_UP = "agentzero.wallet-set-up";

export interface Month { capUsd: number; spentUsd: number; endsAtIso: string | null }
/** "fresh": never funded (first run); "ok"; "low": under $1; "empty": nothing to think with; "cap": the month's cap
 *  reached; "fees": USDC but no NEAR left for sending fees (the next fill adds it). */
export type WalletState = "loading" | "unread" | "fresh" | "ok" | "low" | "empty" | "cap" | "fees";
export type Done = { ok: true; usd?: number } | { declined: true } | { line: string; code?: string | undefined };

/** D37: why the last message was refused before Claude was asked: AgentZero's money doesn't cover it, or it couldn't be
 *  read; null: not refused. */
export type Refused = "money" | "unread" | null;

/**
 * D37 (QA 4 Nov: a $0 wallet got three paid replies): may a message go? Only when AgentZero's own money, as this phone
 * read it (its USDC less anything unpaid), covers the most one reply can cost (REPLY_HOLD_MICROS, the relay's own
 * check). Not read yet, or unreadable: refused as unread, never sent on hope. Pure: the tests run it.
 */
export function mayAsk(state: WalletState, totalUsd: number | null): Refused {
  if (state === "loading" || state === "unread" || totalUsd === null) return "unread";
  if (state !== "ok" && state !== "low") return "money";
  return Math.round(totalUsd * 1e6) >= REPLY_HOLD_MICROS ? null : "money";
}

/** After a fill: its money lands in 30 s to a few minutes, so AgentZero's wallet is read again every FILL_READ_MS until it
 *  shows more, at most FILL_READS times (QA 4 Nov: nothing read it again, so a landed fill still read $0). */
export const FILL_READ_MS = 10_000;
export const FILL_READS = 18;
/** Did the money land? AgentZero's USDC now is more than before the fill. */
export const fillLanded = (before: number | null, now: number | null): boolean => now !== null && now > (before ?? 0) + 1e-6;
/** The fill is all in: its USDC landed and, when it carried AgentZero's fees (its NEAR was low), the NEAR for them too
 *  (a test run, 5 Nov: the reads stopped at the USDC, so "needs a little NEAR for fees" stayed after the fees leg). */
export const fillSettled = (before: number | null, now: number | null, feesWereLow: boolean, feesLowNow: boolean): boolean => fillLanded(before, now) && (!feesWereLow || !feesLowNow);

/** D37, the credit from before prepaid (QA 4 Nov: a few cents owed for hours, never paid, no receipt): it is paid from the
 *  first money that lands in AgentZero's wallet, with its receipt row in Activity. Due when what AgentZero holds covers it. */
export const creditDue = (walletUsd: number | null, owedMicros: number): boolean => walletUsd !== null && owedMicros > 0 && Math.round(walletUsd * 1e6) >= owedMicros;

/** One owed batch as the relay says it: its memo, its batch, what was paid of it and what it asks now; null: nothing owed. */
export const batchKey = (o: ReplyOwed | null): string | null => (o && o.owedMicros > 0 ? `${o.memo}|${o.reply}|${o.paidMicros ?? 0}|${o.owedMicros}` : null);
/**
 * QA MUST (no double pay): may the credit be paid by itself now? Never while a settle runs, and never the same
 * batch figure twice: a relay still answering the figure it was just paid for (a slow count), with AgentZero's balance
 * changing under it, pays nothing more. A new figure from the relay pays once. `last` keeps the last figure paid or tried.
 */
export function autoSettleNow(last: { key: string | null }, o: { walletUsd: number | null; owed: ReplyOwed | null; inFlight: boolean }): boolean {
  if (o.inFlight || !creditDue(o.walletUsd, o.owed?.owedMicros ?? 0)) return false;
  const k = batchKey(o.owed);
  if (!k || k === last.key) return false;
  last.key = k;
  return true;
}

export interface WalletSource {
  state: WalletState;
  /** AgentZero's own NEAR account (the relay reads its USDC before each reply, D37); null until read. */
  account: string | null;
  /** D37: the last message was refused before Claude was asked (mayAsk), or the relay refused it for money. */
  refused: Refused;
  setRefused: (r: Refused) => void;
  /** QA: AgentZero's key's proof that a sign-up token's id is its own (the relay binds the id to this account). */
  bindFor: (token: string) => Promise<string | null>;
  /** AgentZero's own USDC; null when it can't be read now. */
  walletUsd: number | null;
  /** Its NEAR for sending fees, in NEAR; null when it can't be read. */
  feesNear: number | null;
  /** What AgentZero has: its USDC less what it owes ZeroFee (paid at $0.25); null when it can't be read. */
  totalUsd: number | null;
  /** The meter (product decision, 4 Nov): what AgentZero's replies cost today, what it paid today, and what it owes now. */
  usedUsd: number;
  paidUsd: number;
  owedUsd: number;
  /** What the last paid reply cost, exactly, as the relay counted it; null before one this open. */
  lastUsd: number | null;
  /** What the message now on screen was charged: its receipt's sum (every payment made while it ran); null before one. */
  turnPaidUsd: number | null;
  /** While a reply streams: its words so far at the model's price (live-chat.ts sets it), on top of `usedUsd`. */
  liveUsd: number;
  setLive: (micros: number) => void;
  month: Month | null;
  /** The NEAR wallet a fill comes from; null when it can't be read. */
  nearUsd: number | null;
  /** The least a fill may be now, and the part of it that becomes NEAR for fees, as the core reads them
   *  (account.agent.wallet fillMinMicros, fillFeesMicros); null until read. */
  fillMinUsd: number | null;
  fillFeesUsd: number;
  /** A reply was paused mid-task for want of money, until money is added. */
  paused: boolean;
  /** The core's own words when it refused (a payment, the set-up), said as they are. */
  problem: string | null;
  refresh: () => void;
  /** `tap`: the person's own click on the Add button (D143: a fill starts only from a trusted tap on that amount). */
  /** `made`: the fill's job exists (its Face ID said yes, or the core answered): the sheet says "Job created." */
  fund: (usd: number, tap: unknown, made?: () => void) => Promise<Done>;
  empty: () => Promise<Done>;
  setCap: (usd: number) => Promise<Done>;
  /** The relay's word on what AgentZero owes (a call's closing line, with its own cost; or the 402). */
  owe: (owed: ReplyOwed) => void;
  /** A paid reply's exact cost from the relay's closing line, when it carried no batch figure (owe has it otherwise):
   *  the meter moves after every paid reply (product decision, 4 Nov after a reply). */
  cost: (micros: number) => void;
  /** The message now being answered (its bubble's id): its calls' costs and payments are its own, one receipt row. */
  turn: (id: string) => void;
  /** A Stop: the reply's estimate goes on the meter until the relay's next figure says it exactly. */
  stopped: (estMicros: number) => void;
  /** Before a Claude call: a payment kept from before is counted, and what is owed is paid when it is due (at $0.25, or
   *  when the balance less it wouldn't cover the next reply; `all`: whatever is owed, now, e.g. before Move all). → may
   *  it go. */
  settle: (o?: { all?: boolean }) => Promise<boolean>;
  setup: () => Promise<Done>;
  setPaused: (p: boolean) => void;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const lineOf = (r: { problem?: { whatHappened?: string } }) => r.problem?.whatHappened ?? "That didn't go through. Nothing moved.";
let keyN = 0;
const moveKey = (p: string) => `${p}-${Date.now().toString(36)}-${(keyN++).toString(36)}`;

/** The state the screen shows, from the numbers (pure; the tests use it). */
/** `walletUsd`: what AgentZero has (its USDC less what it owes); `owes`: it owes ZeroFee something now (so it isn't new). */
export function walletState(o: { walletUsd: number | null; feesLow?: boolean; month: Month | null; loaded: boolean; owes?: boolean }): WalletState {
  if (!o.loaded) return "loading";
  // can't see AgentZero's wallet now: no line says it's empty (the chip says "AgentZero" with no number)
  if (o.walletUsd === null) return "unread";
  const spent = o.month?.spentUsd ?? 0;
  if (o.walletUsd <= 0 && spent <= 0 && !o.owes) return "fresh";
  if (o.month && spent >= o.month.capUsd - 1e-9) return "cap";
  if (o.walletUsd < EMPTY_BELOW_USD) return "empty";
  if (o.feesLow) return "fees";
  if (o.walletUsd < LOW_BELOW_USD) return "low";
  return "ok";
}

/** The memo the relay names a payment for this phone's id with (apps/quotes/agentzero-pay.mjs memoOf), from its own token. */
export async function memoFor(token: string): Promise<string | null> {
  const id = /^az1\.([A-Za-z0-9_-]{22})\./.exec(token)?.[1];
  if (!id) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`agentzero-reply:${id}`)));
  return `agentzero ${Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

/** What AgentZero owes now, as the relay says it (POST /v0/agentzero/pay {}): the batch, null for nothing, undefined
 *  when it can't be asked (no relay, no sign-up, or a relay from before batches: then the last figure heard stands). */
export async function askOwed(o: { fetch: typeof fetch; base: string | null; token: string | null }): Promise<ReplyOwed | null | undefined> {
  if (!o.base || !o.token) return o.token ? undefined : null;
  try {
    const res = await o.fetch(`${o.base}/v0/agentzero/pay`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.token}` }, body: "{}", signal: AbortSignal.timeout(15_000) });
    const b = (await res.json().catch(() => null)) as ({ state?: string } & Parameters<typeof owedOf>[0]) | null;
    if (!res.ok || !b) return undefined;
    if (b.state === "paid") return null;
    return b.state === "owed" ? (owedOf(b) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** A payment the relay counted: how much, and what is still owed after it (null: nothing; undefined: it didn't say). */
/** `tx`: the payment's NEAR transaction (its receipt's proof in Activity). */
export type Paid = { ok: true; paidMicros?: number; left?: ReplyOwed | null; tx?: string };

/**
 * Pay what AgentZero owes and have the relay count it (pure of React: the tests run it). The core pays its own figure
 * (the batch's usage × the one price table), the same transaction again if it already paid this figure; the relay reads
 * it on chain. A payment the relay can't find yet stays the core's to send again (never a second one).
 */
export async function payOwed(o: { call: Bridge["call"]; fetch: typeof fetch; base: string | null; token: string | null; owed: ReplyOwed | null }): Promise<Paid | { line: string; code?: string }> {
  // a payment the core kept from before (a crash, a retry): counted first, before anything new
  const kept = await o.call<{ tx: string; from: string; micros: number } | null>("account.agent.wallet", { do: "pay", op: "pending" });
  let pay: { tx: string; from: string; micros?: number } | null = "ok" in kept && kept.ok ? kept.ok : null;
  if (!pay) {
    if (!o.owed) return { ok: true };
    // SR3 L8: the payment's memo must be this phone's own id's, as the relay makes it (never another id's)
    if (o.token && o.owed.memo !== (await memoFor(o.token))) return { line: "That payment's note isn't this phone's. Nothing was paid." };
    const r = await o.call<{ tx: string; from: string; micros: number }>("account.agent.wallet", {
      do: "pay", op: "reply", owedMicros: o.owed.owedMicros, usage: o.owed.usage, model: o.owed.model, memo: o.owed.memo, reply: o.owed.reply,
      ...(o.owed.byModel !== undefined ? { byModel: o.owed.byModel, replies: o.owed.replies ?? 1, paidMicros: o.owed.paidMicros ?? 0 } : {}),
    });
    if (!("ok" in r)) return { line: lineOf(r as never), code: (r as { problem?: { code?: string } }).problem?.code };
    pay = r.ok;
  }
  if (!o.base || !o.token) return { line: "Couldn't reach ZeroFee. Try again." };
  try {
    const res = await o.fetch(`${o.base}/v0/agentzero/pay`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.token}` }, body: JSON.stringify({ tx: pay.tx, from: pay.from }), signal: AbortSignal.timeout(30_000) });
    const b = (await res.json().catch(() => null)) as ({ state?: string; code?: string; why?: string; micros?: unknown } & Parameters<typeof owedOf>[0]) | null;
    if (res.ok && b?.state === "paid") {
      await o.call("account.agent.wallet", { do: "pay", op: "counted", tx: pay.tx });
      // what the relay took off, and what it says is still owed (a relay from before batches says nothing more)
      const micros = Number.isSafeInteger(b.micros) && (b.micros as number) > 0 ? (b.micros as number) : 0;
      return { ok: true, ...(micros ? { paidMicros: micros, tx: pay.tx } : {}), ...(b.owedMicros !== undefined ? { left: owedOf(b) } : {}) };
    }
    // already counted (a retry after the relay's answer was lost): done
    if (res.status === 409 && b?.code === "agentzero.pay.used") {
      await o.call("account.agent.wallet", { do: "pay", op: "counted", tx: pay.tx });
      return { ok: true };
    }
    // NEAR doesn't know it: the core forgets it only once it provably can't land; otherwise it is sent again
    if (b?.why === "NEAR doesn't know that payment") await o.call("account.agent.wallet", { do: "pay", op: "forget", tx: pay.tx });
    return { line: "AgentZero's payment is on its way. Try again in a moment." };
  } catch {
    return { line: "Couldn't reach ZeroFee. Try again." };
  }
}

/** Pay now? What is owed has reached $0.25, or the balance less it wouldn't cover the next reply, or `all` was asked. */
export function payNow(owed: ReplyOwed | null, walletUsd: number | null, all = false): boolean {
  if (!owed || !(owed.owedMicros > 0)) return false;
  if (all || owed.owedMicros >= SETTLE_AT_MICROS) return true;
  return walletUsd !== null && Math.round(walletUsd * 1e6) - owed.owedMicros < REPLY_CAP_MICROS;
}

/**
 * One settle (pure of React: the tests run it): with `all`, the relay's own figure first (a Stop's cost included); then,
 * when it is due (payNow), ONE payment for all of it; a payment kept from before is counted either way. → the payment's
 * outcome, the figure it went by (`asked`: the relay's, when it was asked) and the figure after (`left`).
 */
export async function settleNow(o: { all: boolean; owed: ReplyOwed | null; walletUsd: number | null; call: Bridge["call"]; fetch: typeof fetch; base: string | null; token: string | null }): Promise<{ r: Paid | { line: string; code?: string }; asked?: ReplyOwed | null; due: boolean }> {
  let owed = o.owed;
  let asked: ReplyOwed | null | undefined;
  if (o.all) {
    asked = await askOwed({ fetch: o.fetch, base: o.base, token: o.token });
    if (asked !== undefined) owed = asked;
  }
  const due = payNow(owed, o.walletUsd, o.all);
  const r = await payOwed({ call: o.call, fetch: o.fetch, base: o.base, token: o.token, owed: due ? owed : null });
  return { r, ...(asked !== undefined ? { asked } : {}), due };
}

export function useAgentWallet(bridge: Bridge): WalletSource {
  // D144: fills and empties are tasks in the app's one Activity centre (when the shell has it)
  const tasks = tasksOf(useContext(ShellContext));
  // the shell's tasks facade is a new object with each new shell context: read through a ref, so the payment path and
  // the read on open never re-run for it (QA, 5 Nov: each re-run added the meter to itself)
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [walletUsd, setWallet] = useState<number | null>(null);
  const [feesNear, setFees] = useState<number | null>(null);
  const [feesLow, setFeesLow] = useState(false);
  const feesLowNow = useRef(false);
  const [fillMin, setFillMin] = useState<{ min: number | null; fees: number }>({ min: null, fees: 0 });
  const [month, setMonth] = useState<Month | null>(null);
  const [nearUsd, setNear] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [refused, setRefusedNow] = useState<Refused>(null);
  /** The proof per sign-up id, made once by the core (the same signature every time). */
  const proofs = useRef(new Map<string, string>());
  const bindFor = useCallback(async (tok: string): Promise<string | null> => {
    const id = /^az1\.([A-Za-z0-9_-]{22})\./.exec(tok)?.[1];
    if (!id) return null;
    const had = proofs.current.get(id);
    if (had) return had;
    const r = await bridge.call<{ account: string; proof: string }>("account.agent.wallet", { do: "pay", op: "bind", id });
    if (!("ok" in r) || !r.ok || !/^[0-9a-f]{128}$/.test(r.ok.proof)) return null;
    proofs.current.set(id, r.ok.proof);
    return r.ok.proof;
  }, [bridge]);
  /** What AgentZero owes, as the relay last said it (null: nothing); `known`: this phone knows where the batch stands. */
  const owed = useRef<ReplyOwed | null>(null);
  /** The owed batch figure last paid or auto-settled (autoSettleNow). */
  const autoLast = useRef<{ key: string | null }>({ key: null });
  const known = useRef(false);
  /** Stop estimates on the meter that the relay's next figure replaces. */
  const est = useRef(0);
  const [owedMicros, setOwedMicros] = useState(0);
  const [liveMicros, setLiveMicros] = useState(0);
  const setLive = useCallback((micros: number) => setLiveMicros(micros > 0 ? micros : 0), []);
  const [meter, setMeter] = useState<Meter>(() => readMeter(null, dayOf()));
  const meterRef = useRef(meter);
  // the meter starts again at local midnight, also while the chat is open
  const [day, setDay] = useState(dayOf);
  useEffect(() => {
    const t = setTimeout(() => setDay(dayOf()), untilMidnight() + 1_000);
    return () => clearTimeout(t);
  }, [day]);
  /** The kept meter was read (once per open); until then what is heard is kept apart and added to it once. */
  const read = useRef(false);
  const early = useRef<Meter>(readMeter(null, dayOf()));
  const bump = useCallback((used: number, paid = 0) => {
    const m = readMeter(JSON.stringify(meterRef.current), dayOf());
    const next = { day: m.day, usedMicros: Math.max(0, m.usedMicros + used), paidMicros: m.paidMicros + paid };
    meterRef.current = next;
    setMeter(next);
    // before the kept figures are read, nothing is written over them: what is heard waits to be added once
    if (!read.current) {
      const e = readMeter(JSON.stringify(early.current), m.day);
      early.current = { day: m.day, usedMicros: Math.max(0, e.usedMicros + used), paidMicros: e.paidMicros + paid };
      return;
    }
    void bridge.call("device.store.set", { key: METER_KEY, value: JSON.stringify(next) });
  }, [bridge]);
  /** What the last paid reply cost, exactly (the relay's figure): read_meter says it (product decision, 5 Nov: "What did my last
   *  message cost?" got no figure). */
  const [lastMicros, setLastMicros] = useState<number | null>(null);
  // QA (5 Nov): a reply of several calls made a receipt row per payment (0.4¢ + 0.3¢), and "what did my last
  // message cost?" had no figure. A message's calls add up (`turnSum`); its payments make one row (`turnId`); when the
  // next message starts, the last one's whole cost is what read_meter says it cost.
  const turnId = useRef<string | null>(null);
  const turnSum = useRef(0);
  // the receipt's own sum for this message (az-tasks replyReceipt adds the same payments into one row)
  const [turnPaid, setTurnPaid] = useState<number | null>(null);
  const turn = useCallback((id: string) => {
    if (turnId.current === id) return;
    if (turnId.current !== null && turnSum.current > 0) setLastMicros(turnSum.current);
    turnId.current = id;
    turnSum.current = 0;
    setTurnPaid(null);
  }, []);
  /** A figure from the relay: the meter takes what is new in it; the figure is what is owed now. */
  const heard = useCallback((o: ReplyOwed | null, turnMicros = 0) => {
    const add = heardMicros(owed.current, known.current, o, turnMicros, known.current ? est.current : 0);
    if (known.current) est.current = 0;
    if (add) bump(add);
    owed.current = o;
    known.current = true;
    setOwedMicros(o?.owedMicros ?? 0);
  }, [bump]);
  const token = useCallback(async () => {
    const r = await bridge.call<{ value: string | null }>("device.secret.get", { key: CHAT_SECRETS.token });
    return "ok" in r ? (r.ok?.value ?? null) : null;
  }, [bridge]);
  const walletNow = useRef<number | null>(null);
  const refresh = useCallback(() => {
    void (async () => {
      const [w, m, s] = await Promise.all([
        bridge.call<{ address?: string; usdcMicros: string; nearYocto?: string; feesLow?: boolean; fillMinMicros?: string; fillFeesMicros?: string }>("account.agent.wallet", {}),
        bridge.call<Month>("account.agent.wallet", { do: "pay", op: "month" }),
        bridge.call<{ reserveUsd?: string; cashUsd?: string; unread?: boolean }>("spending.status", {}),
      ]);
      walletNow.current = "ok" in w && w.ok ? Number(w.ok.usdcMicros) / 1e6 : null;
      if ("ok" in w && typeof w.ok?.address === "string" && /^[0-9a-f]{64}$/.test(w.ok.address)) setAccount(w.ok.address);
      setWallet(walletNow.current);
      setFees("ok" in w && w.ok && w.ok.nearYocto ? Number(BigInt(w.ok.nearYocto) / 10n ** 18n) / 1e6 : null);
      feesLowNow.current = "ok" in w && !!w.ok?.feesLow;
      setFeesLow(feesLowNow.current);
      // the core's own floor (never a copy here): null while unread, and the core still checks every fill
      const min = "ok" in w ? num(w.ok?.fillMinMicros) : null, fees = "ok" in w ? num(w.ok?.fillFeesMicros) : null;
      setFillMin((was) => (min === null ? (was.min === null ? was : { min: null, fees: 0 }) : was.min === min / 1e6 && was.fees === (fees ?? 0) / 1e6 ? was : { min: min / 1e6, fees: (fees ?? 0) / 1e6 }));
      if ("ok" in m && m.ok) setMonth({ capUsd: num(m.ok.capUsd) ?? 20, spentUsd: num(m.ok.spentUsd) ?? 0, endsAtIso: typeof m.ok.endsAtIso === "string" ? m.ok.endsAtIso : null });
      setNear("ok" in s && s.ok && !s.ok.unread ? num(s.ok.reserveUsd ?? s.ok.cashUsd) : null);
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [bridge]);
  // a message refused for money reads the wallet again (money may have landed since: a fill, or someone else's top-up)
  const setRefused = useCallback((r: Refused) => {
    setRefusedNow(r);
    if (r === "money") refresh();
  }, [refresh]);
  const landing = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchFill = useCallback((before: number | null, feesWereLow: boolean) => {
    if (landing.current) clearInterval(landing.current);
    let n = 0;
    landing.current = setInterval(() => {
      // read until the USDC and, when the fill carried them, the fees landed: then the fees line goes by itself
      if (++n > FILL_READS || fillSettled(before, walletNow.current, feesWereLow, feesLowNow.current)) {
        clearInterval(landing.current!);
        landing.current = null;
        return;
      }
      refresh();
    }, FILL_READ_MS);
  }, [refresh]);
  useEffect(() => () => void (landing.current && clearInterval(landing.current)), []);
  /** One settle at a time; a settle for everything (Move all) waits for one already running, then pays the rest. */
  const paying = useRef<Promise<Paid | { line: string; code?: string }> | null>(null);
  const run = useCallback(async (all: boolean): Promise<Paid | { line: string; code?: string }> => {
    // everything owed (all): the relay's own figure now (a Stop's cost included), never only the last one heard
    const was = owed.current;
    const { r, asked, due } = await settleNow({ all, owed: owed.current, walletUsd: walletNow.current, call: bridge.call.bind(bridge), fetch: (...a) => fetch(...a), base: relayBase(), token: await token() });
    if (asked !== undefined) heard(asked);
    if ("ok" in r) {
      // the figure just paid is never paid again by itself (autoSettleNow), whatever the relay says next
      if (r.paidMicros) autoLast.current.key = batchKey(asked ?? was);
      if (r.paidMicros) bump(0, r.paidMicros);
      // D37: each paid reply is a receipt row in Activity (the payment that paid it, as the relay counted it)
      if (r.paidMicros && turnId.current) { const paid = r.paidMicros; setTurnPaid((n) => (n ?? 0) + paid); }
      if (r.paidMicros) replyReceipt(tasksRef.current, r.paidMicros, receiptTitle(r.paidMicros), Date.now, r.tx, turnId.current ? { id: turnId.current, titleOf: receiptTitle } : undefined);
      // what the relay says is left (a reply settled while it was on its way); a relay from before batches: all of it
      if (r.left !== undefined) heard(r.left);
      else if (due) heard(null);
      if (r.paidMicros || due) refresh();
      setProblem(null);
      return r;
    }
    setProblem(r.line);
    if (r.code === "agentzero.pay.empty" || r.code === "agentzero.pay.fees" || r.code === "agentzero.pay.cap") refresh();
    return r;
  }, [bridge, token, refresh, heard, bump]);
  const settleFor = useCallback((all: boolean): Promise<Paid | { line: string; code?: string }> => {
    const was = paying.current;
    if (was && !all) return was;
    const next = (was ? was.catch(() => null) : Promise.resolve(null)).then(() => run(all)).finally(() => void (paying.current === next && (paying.current = null)));
    paying.current = next;
    return next;
  }, [run]);
  const settle = useCallback((o?: { all?: boolean }) => settleFor(!!o?.all).then((r) => "ok" in r), [settleFor]);
  const owe = useCallback((o: ReplyOwed) => {
    // the call's exact cost takes the estimate's place in the same frame (the meter snaps, never adds both)
    if (o.turnMicros !== undefined) setLiveMicros(0);
    if (o.turnMicros !== undefined) turnSum.current += o.turnMicros;
    heard(o, o.turnMicros ?? 0);
    // paid at once when it is due, so the next reply rarely waits
    void settle();
  }, [heard, settle]);
  const cost = useCallback((micros: number) => {
    if (!(micros > 0)) return;
    // the exact figure takes the streaming estimate's place in the same frame, as owe's does
    setLiveMicros(0);
    turnSum.current += micros;
    bump(micros);
  }, [bump]);
  const stopped = useCallback((micros: number) => {
    if (!(micros > 0)) return;
    est.current += micros;
    setLiveMicros(0);
    bump(micros);
  }, [bump]);
  // on every open: the meter kept on this phone, AgentZero's wallet and month, what it owes (asked, never added to the
  // meter: it was counted when it was heard), and any payment a crash left uncounted
  // the kept meter, read once per open: anything heard before it answered is added to it once (keptPlusEarly)
  useEffect(() => {
    let live = true;
    read.current = false;
    void bridge.call<{ value: string | null }>("device.store.get", { key: METER_KEY }).then((r) => {
      if (!live) return;
      const kept = readMeter("ok" in r ? r.ok?.value : null, dayOf());
      const next = keptPlusEarly(kept, early.current);
      early.current = readMeter(null, kept.day);
      read.current = true;
      meterRef.current = next;
      setMeter(next);
      void bridge.call("device.store.set", { key: METER_KEY, value: JSON.stringify(next) });
    });
    return () => void (live = false);
  }, [bridge]);
  useEffect(() => {
    let live = true;
    refresh();
    void (async () => {
      const now = await askOwed({ fetch: (...a) => fetch(...a), base: relayBase(), token: await token() });
      if (live && now !== undefined && !known.current) {
        owed.current = now;
        known.current = true;
        setOwedMicros(now?.owedMicros ?? 0);
      }
      if (live) void settle();
    })();
    return () => void (live = false);
  }, [bridge, refresh, settle, token]);
  const fund = useCallback(async (usd: number, tap: unknown, made?: () => void): Promise<Done> => {
    // the core's floor as last read (it checks again and says its own reason by name)
    if (fillMin.min !== null && !(usd >= fillMin.min - 1e-9)) return { line: fillFloor(fillMin.min, fillMin.fees) };
    const feesWereLow = feesLowNow.current || walletNow.current === null;
    // D143: the one way a fill starts: the person's own trusted tap on the Add button marked with this amount (the
    // core then gives a one-time ticket for exactly it). Main's fill asked with no ticket, so the core refused every one.
    // The job (bug report, 5 Nov): made at the tap (the NEAR wallet is a hot key: one tap, no Face ID, agent-faceid.ts):
    // its row on Home and in Activity, the bell's pulse, the sheet's "Job created."; a second fill meanwhile is refused
    const end = await runJob<{ declined?: true }>({
      tasks: tasksRef.current ?? undefined, title: `Add $${usd.toFixed(2)} to AgentZero's wallet`, usd: `$${usd.toFixed(2)}`, etaSec: LEG_SEC.nearToSafe, safe: false, money: ["agent", "row:near"],
      call: async () => (await fillOnTap(bridge, tap, String(Math.round(usd * 1e6)), moveKey("agent-fill"))) as never,
      declined: (r) => "ok" in r && r.ok?.declined === true,
      made: () => made?.(),
    });
    if ("declined" in end) { walletTask(tasksRef.current, "fill", usd, { declined: true }); return { declined: true }; }
    if ("refused" in end) { const line = lineOf({ problem: end.refused } as never); walletTask(tasksRef.current, "fill", usd, { line }); return { line }; }
    if ("problem" in end) return { line: lineOf({ problem: end.problem } as never) };
    const row = walletTask(tasksRef.current, "fill", usd, { ok: true });
    end.job.made(row ? [row] : []);
    setProblem(null);
    setRefusedNow(null);
    setPaused(false);
    refresh();
    watchFill(walletNow.current, feesWereLow);
    return { ok: true, usd };
  }, [bridge, refresh, watchFill, fillMin]);
  const empty = useCallback(async (): Promise<Done> => {
    // product decision, 4 Nov: nothing left owing, then the move (what AgentZero owes ZeroFee is paid first, in one go)
    const paid = await settleFor(true);
    if (!("ok" in paid)) {
      walletTask(tasksRef.current, "empty", null, { line: paid.line });
      return { line: paid.line };
    }
    const r = await bridge.call<{ declined?: true }>("account.agent.wallet", { do: "empty", key: moveKey("agent-empty") });
    const done: Done = !("ok" in r) ? { line: lineOf(r as never) } : r.ok?.declined ? { declined: true } : { ok: true };
    if ("ok" in done) refresh();
    walletTask(tasksRef.current, "empty", null, "ok" in done ? { ok: true } : "declined" in done ? { declined: true } : { line: done.line });
    return done;
  }, [bridge, refresh, settleFor]);
  const setCap = useCallback(async (usd: number): Promise<Done> => {
    const r = await bridge.call<{ capUsd?: number; declined?: true }>("account.agent.wallet", { do: "pay", op: "cap", usd });
    if (!("ok" in r)) return { line: lineOf(r as never) };
    if (r.ok?.declined) return { declined: true };
    refresh();
    return { ok: true, usd: r.ok?.capUsd ?? usd };
  }, [bridge, refresh]);
  const setup = useCallback(async (): Promise<Done> => {
    const done = await bridge.call<{ value: string | null }>("device.store.get", { key: SET_UP });
    if ("ok" in done && done.ok?.value === "1") return { ok: true };
    const r = await bridge.call<{ revoked: boolean; outcome?: { status: string; problem?: { whatHappened?: string } } }>("account.agent.wallet", { do: "setup" });
    if (!("ok" in r)) {
      const line = lineOf(r as never);
      setProblem(line);
      return { line, code: (r as { problem?: { code?: string } }).problem?.code };
    }
    const o = r.ok?.outcome;
    if (o?.status === "declined") return { declined: true };
    if (o?.status === "problem") {
      const line = o.problem?.whatHappened ?? "That didn't go through. Nothing moved.";
      setProblem(line);
      return { line };
    }
    setProblem(null);
    void bridge.call("device.store.set", { key: SET_UP, value: "1" });
    return { ok: true };
  }, [bridge]);
  // the old credit is paid as soon as AgentZero's money covers it (a receipt row in Activity, through run): once per batch
  // figure, never while a settle runs (QA MUST)
  useEffect(() => {
    if (autoSettleNow(autoLast.current, { walletUsd, owed: owed.current, inFlight: !!paying.current })) void settle();
  }, [walletUsd, owedMicros, settle]);
  // what AgentZero has is its USDC less what it owes ZeroFee: low, empty and "Add money" read that
  const totalUsd = walletUsd === null ? null : Math.max(0, Math.round(walletUsd * 1e6) - owedMicros) / 1e6;
  const state = walletState({ walletUsd: totalUsd, feesLow, month, loaded, owes: owedMicros > 0 });
  const today = day === meter.day ? meter : readMeter(null, day);
  const usedUsd = today.usedMicros / 1e6;
  const paidUsd = today.paidMicros / 1e6;
  const owedUsd = owedMicros / 1e6;
  const liveUsd = liveMicros / 1e6;
  // the sheet's month counts what was used: what the core counted (paid) and what is owed now
  const shownMonth = useMemo(() => monthShown(month, owedUsd), [month, owedUsd]);
  return useMemo(() => ({
    state, account, refused, setRefused, bindFor, walletUsd, feesNear, totalUsd, usedUsd, paidUsd, owedUsd, lastUsd: lastMicros === null ? null : lastMicros / 1e6, turnPaidUsd: turnPaid === null ? null : turnPaid / 1e6, liveUsd, month: shownMonth, nearUsd, fillMinUsd: fillMin.min, fillFeesUsd: fillMin.fees, paused, problem,
    refresh, fund, empty, setCap, owe, cost, turn, stopped, settle, setup, setPaused, setLive,
  }), [state, account, refused, bindFor, walletUsd, feesNear, totalUsd, usedUsd, paidUsd, owedUsd, lastMicros, turnPaid, liveUsd, shownMonth, nearUsd, fillMin, paused, problem, refresh, fund, empty, setCap, owe, cost, turn, stopped, settle, setup, setLive]);
}
