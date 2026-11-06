// AgentZero (AZ1–AZ3, D75–D78): the Agent tab. "A helper with its wallet. One job. One limit. A receipt for
// everything. Stop any time."
// - The rule box: the person types a job in words; AgentZero answers with ONE sheet (the job, the limit, Approve or
//   Start). Never free chat (rulebox.ts).
// - Jobs: four rows, in order (jobs.ts). Each has a start sheet, its own limit inside its wallet, receipts and a stop.
// - Its wallet: the ONE limit the account contract holds AgentZero's key to (release 10). Turning AgentZero on, or
//   changing it, is the core's Approve (Face ID); a new key waits a change's wait (D59) and the row says until when.
// - Receipts: one row per thing AgentZero did or refused, "AgentZero bought $5 of SOL · 9:00 AM · Why ›"; Why is one
//   tap down, with the check and NEAR AI Cloud's proof below it.
// - "Stop AgentZero" at the floor: the core's Approve takes its key off the account. Every job stops.
// AgentZero's key stays on this device (D76 amended): jobs run while ZeroFee is open (runner.ts decides, the core signs).
// The jobs, receipts and the day's spending live in AgentZero's engine (zero/engine.ts), not in this screen: Chat's
// request chip pays through the same engine while this tab isn't drawn.
import { ownWalletWords } from "@zerofee/core/own-wallet-words";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { oneAtATime } from "./one-at-a-time.ts";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { agentZeroSteps, onAgentZeroStep, type AgentZeroStep } from "@zerofee/shell-api/agentzero-steps.ts";
import { ThisDevice, onPhone, thisDevice } from "@zerofee/shell-api/approval-words.ts";
import { USDC_ID, WNEAR_ID } from "../agent-pay.ts";
import { zeroBudget } from "../zero/budget.ts";
import { MODEL, NearAiError, attest, type Proof } from "../nearai.ts";
import { doWords, routineDry, routineLines, whenWords, type RoutineTerms } from "../zero/routines.ts";
import { cannotJobLine, JOB_ORDER, KEEP_WALLET, KEEP_WALLETS, noPayLine, NO_POCKET_LINE, NOT_OFFERED_LINE, POCKET_UPDATE_TITLE, pocketUpdateLine, OPEN_LINE, jobOffered, jobStarts, jobsLine, offeredJobs, overPocketLine, OVER_DAY_LINE, POCKET_CHOICES, POCKET_DEFAULT, defaultTerms, dollars, fitLine, jobLine, listWaiting, pocketFix, pocketWaitLine, pocketAtOnce, pausedLine, parseList, runningList, safeKeyOffered, COPY_DAY_MOST, jobTitle, newJobId, startSheet, termsProblem, type Job, type JobKind, type JobTerms } from "../zero/jobs.ts";
import { spentToday, type Event } from "../zero/runner.ts";
import { logLine, makeReceipt, receiptTime, type Receipt } from "../zero/receipts.ts";
import { taskStore, type Tasks } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { fillJob } from "../zero/wallet-fill.ts";
import { pageRows, raiseShown, RAISE_KEY, readRaise, replyRows, type Raise, type ReplyRow } from "./page-rows.ts";
import { SEALED, checkedLine } from "../zero/attest-line.ts";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";
import type { ChatSheet } from "../chat/turn.ts";
import { MEMORY_KIND_WORDS, memoryStore, type MemoryLine } from "../zero/memory.ts";
import { onDemoPage } from "@zerofee/shell-api/release.ts";
import { ADD_BUTTON, addable, FUND_AMOUNTS, FUND_BUTTON, FUND_JOB_WORDS, FUND_TITLE, fillFundJob, fundJob, fundLines, jobCostLine, STOP_BACK_DONE, STOP_BACK_LINE, walletRow } from "./fund-words.ts";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { receiptLeft } from "@zerofee/shell-api/job-steps.ts";
import { startJob as startMoneyJob, watchShown, type JobHandle } from "@zerofee/shell-api/job-start.ts";

/** What the chat's card says for something AgentZero can't do yet (an act while AGENT_ACT is off). */
const CANT_YET = "AgentZero can't do this yet.";
// D124/D128/D129: the product money words. Trading's cash (USDC on NEAR Intents) is "your NEAR wallet"; every move is
// private, so there is no Hidden; BNB is named only once it opens (float-moves.ts bsc open: false).
const PLACE: Record<string, string> = { spending: "your NEAR wallet", hidden: "your NEAR wallet", safe: "your Safe", sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
/** The chat's act in a few words, e.g. "Move $5 from your NEAR wallet to your SOL wallet". */
export function actWords(a: { act: string; from: string; to: string | null; usd: number }): string {
  const verb = { move: "Move", swap: "Swap", trade: "Trade", send: "Send", pay: "Pay" }[a.act] ?? "Do";
  return `${verb} ${dollars(a.usd)} from ${PLACE[a.from] ?? a.from}${a.to ? ` to ${PLACE[a.to] ?? a.to}` : ""}`;
}
import { PRIVATE_OFF_LINE, zeroEngine, type Snapshot } from "../zero/engine.ts";
import { runChatAct, type ChatAct } from "../zero/chat-act.ts";
import { OWN_KEY_ON } from "../chat/own-key.ts";
import { CANNOT_LINE, readJob, type Allowance, type Reading, type RuleFault } from "../zero/rulebox.ts";
import { Send } from "./icons.tsx";
import { AppBrowser, AppHome, Check, Copy } from "@zerofee/design/icons.tsx";
import { LeaderCard } from "./LeaderCard.tsx";
import { LeaderField } from "./LeaderField.tsx";
import { AzLead } from "./AzLead.tsx";
import { offersTurnOn, pausedUntil, pocketFrom, readWithin, type PocketRead } from "./pocket-read.ts";
/** Concept v3.1: a soft glyph per job on the start page (design icons; a glyph, never a logo). */
const JOB_GLYPH: Readonly<Record<JobKind, ReactNode>> = { copy: <Copy />, keep: <AppHome />, "pay-list": <Check />, "sign-in": <AppBrowser /> };
import "./agent.css";
import "@zerofee/design/receipt.css";

const NO_TRAY: TrayItem<"jobs">[] = [];
/** D87: in a phone's browser AgentZero is the same, and says where it differs. */
const PHONE = onPhone();
/** S2: the its wallet read failed or didn't answer; the row is the Try again. */
export const POCKET_UNREAD_LINE = "NEAR didn't answer. Tap to try again.";
/** Where the own key and AgentZero's key are kept, said truthfully for the host. */
const KEPT = PHONE ? "In this phone's keychain." : "Kept on this device, encrypted, in this browser.";
const SAFE = { state: "safe", where: "in your Safe" } as const;
/** In the phone's keychain (device.secret): the person's own Claude key, and the free sign-up's token. */
const SECRETS = { ownKey: "agentzero.claude-key", token: "agentzero.token" };
/** When this phone last paired a computer (no name, no address: only the time). */
const COMPUTER_KEY = "agentzero.computer";
const CLAUDE_KEY = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;

/** AgentZero's state from the core's view (release 10's `agent` view) or the sample's. */
export interface AgentState {
  limitUsd: number;
  spentUsd: number;
  sample: boolean;
  /** The people the account lets AgentZero's key pay (budget.recipients). */
  people: string[];
  /** The budget's end (kept on a change, so a tighter one runs at once). */
  endsAtNs?: string;
  /** The budget's "any address" cap one day, in dollars (D89/D91: open only while a pay list or a keep job runs). */
  anyAddressUsd?: number;
  /** The Sim: the last its wallet in force before a Stop (a turn-on above it waits). */
  lastLimitUsd?: number;
  /** Until when the account's dispute pauses AgentZero's spending (dispute_until, QA). */
  pausedUntilIso?: string;
  /** The Sim: what is really in its wallet (the funding took it from the sample Safe). */
  heldUsd?: number;
  /** The Sim: a higher limit or a turn-on still waiting on the account, as the account has it. */
  waiting?: Raise;
}


/** The core's view in dollars: USDC 1:1, NEAR at today's price. */
export function agentState(view: unknown, nearUsd: number): AgentState | null {
  if (!view || typeof view !== "object") return null;
  const v = view as { limitUsd?: number; lastLimitUsd?: number; heldUsd?: number; waiting?: Raise; disputeUntilNs?: string; spentTodayUsd?: string; sample?: boolean; people?: string[]; budget?: { coins?: { coin: string; per_day: string }[]; recipients?: string[]; ends_at_ns?: string }; spent?: [string, string, string][] };
  if (typeof v.limitUsd === "number") return { limitUsd: v.limitUsd, spentUsd: Number(v.spentTodayUsd ?? 0), sample: v.sample === true, people: Array.isArray(v.people) ? v.people : [], ...(typeof v.lastLimitUsd === "number" ? { lastLimitUsd: v.lastLimitUsd } : {}), ...(typeof v.heldUsd === "number" ? { heldUsd: v.heldUsd } : {}), ...(v.waiting ? { waiting: v.waiting } : {}), ...pausedUntil(v.disputeUntilNs) };
  const usd = (coin: string, units: string) => (coin === USDC_ID ? Number(units) / 1e6 : coin === WNEAR_ID || coin === "near" ? (Number(units) / 1e24) * nearUsd : 0);
  const limit = (v.budget?.coins ?? []).find((c) => c.coin === USDC_ID) as { coin: string; per_day: string; convert_per_day?: string } | undefined;
  return { anyAddressUsd: limit?.convert_per_day ? Number(limit.convert_per_day) / 1e6 : 0, limitUsd: limit ? usd(USDC_ID, limit.per_day) : 0, spentUsd: (v.spent ?? []).reduce((t, [c, day]) => t + usd(c, day), 0), sample: false, people: Array.isArray(v.budget?.recipients) ? v.budget.recipients : [], endsAtNs: v.budget?.ends_at_ns, ...pausedUntil(v.disputeUntilNs) };
}

/** The relay's base, set at build time (VITE_ZEROFEE_RELAY); none in the web demo's sample. */
const RELAY: string | null = (() => {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_RELAY;
  try {
    const u = raw ? new URL(raw) : null;
    // https, or http on this machine only (the dev server's own relay), as Trade's relayBase.
    const local = u?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u && (u.protocol === "https:" || local) && !u.username && !u.password ? u.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
})();

type SheetState =
  | { kind: "routine"; terms: RoutineTerms; said?: string }
  | { kind: "ask" }
  | { kind: "pocket" }
  | { kind: "job"; terms: JobTerms; said?: { words: string; by: Reading["by"] } }
  | { kind: "pay"; to: string; usd: number; words: string; id: string }
  | { kind: "cannot"; line: string; words: string }
  /** The chat's act (D117): one tap opens the core's act-scope sheet (the dry run and Face ID), then the core does it. */
  | { kind: "act"; act: string; from: string; to: string | null; usd: number }
  /** One line, nothing else to pick (an act's outcome; never the job list). `words`: what the person typed, when it
   *  answers them (the Sim's holdings, rule-home.ts); a line per row of `line`. */
  | { kind: "said"; line: string; words?: string }
  | { kind: "stop" }
  | { kind: "key" }
  | { kind: "computer"; said?: string };


/** A sample leader's buys for the web demo's copy job: clearly sample, never a real wallet's. */
const SAMPLE_BUYS = [
  { mint: "sample-bonk", symbol: "BONK" },
  { mint: "sample-wif", symbol: "WIF" },
];

/**
 * Does a running job need the budget's any-address cap (security review M4)? Only a pay list or a keep job, and only
 * once the private route is open: their payments go to a 1Click quote's fresh address, which no list can hold.
 */
export const needsAnyAddress = (jobs: readonly Job[]) => AGENT_PRIVATE_ROUTE && jobs.some((j) => j.on && (j.kind === "pay-list" || j.kind === "keep"));

/** Which part to show: the whole AgentZero app ("all", the old tab), the swipe-up sheet's words box and what a reading
 *  leads to ("ask"), or Settings → AgentZero's jobs, limits and receipts ("settings"). One component, one engine per
 *  bridge (zeroEngine's own WeakMap), so all three see the same jobs and receipts. */
export type AgentZeroPart = "all" | "ask" | "settings" | "sheet";

/** `below`: drawn after the receipts and before the floor (Jobs and limits' memory list: drawn after the page, it was
 *  laid over the receipts and under the Turn on button, QA 5 Nov/036). */
function AgentZeroScreens({ bridge: given, part = "all", onClose, open, below }: { bridge?: Bridge; part?: AgentZeroPart; onClose?: () => void; open?: ChatSheet; below?: ReactNode } = {}) {
  const shell = useShell();
  const bridge = given ?? shell.bridge;
  // "sheet" (the chat's ChatSheetCard): only the one sheet the chat asked for, no words box and no settings.
  const asks = part === "all" || part === "ask";
  const settles = part === "all" || part === "settings";
  const [agent, setAgent] = useState<AgentState | null | undefined>(undefined);
  /** What the core's read said about its wallet (S2): only an answered read offers Turn on; a release 9 account
   *  (no its wallet) gets only what works without it (finding 13); a failed or late read says so, with Try again. */
  const [pocket, setPocketRead] = useState<PocketRead>({ k: "reading" });
  const noPocket = pocket.k === "none";
  // Release 9 accounts: the rules update that gives AgentZero its wallet, when ZeroFee offers it (release 10, D57).
  const [pocketUpdate, setPocketUpdate] = useState<{ waitSeconds: number; thenWaitSeconds?: number; listFirst?: boolean; readyAtIso?: string } | null>(null);
  const [nearUsd, setNearUsd] = useState(0);
  // Jobs, receipts and the day's spending: AgentZero's engine, shared with Chat's chip (zero/engine.ts).
  const engine = useMemo(() => zeroEngine(bridge), [bridge]);
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());
  useEffect(() => engine.subscribe(setSnap), [engine]);
  const { jobs, receipts, spent } = snap;
  // AgentZero's paid replies, as Activity lists them (page-rows.ts): the page's Receipts list them too
  const [replies, setReplies] = useState<ReplyRow[]>(() => replyRows(taskStore().list()));
  useEffect(() => taskStore().subscribe(() => setReplies(replyRows(taskStore().list()))), []);
  // a higher its wallet waiting its safety wait (page-rows.ts), kept on this phone
  const [raiseKept, setRaiseState] = useState<Raise | null>(null);
  useEffect(() => {
    void bridge.call<{ value: string | null }>("device.store.get", { key: RAISE_KEY }).then((r) => "ok" in r && setRaiseState(readRaise(r.ok?.value)));
  }, [bridge]);
  const setRaise = (r: Raise | null) => {
    setRaiseState(r);
    void bridge.call("device.store.set", { key: RAISE_KEY, value: r ? JSON.stringify(r) : null });
  };
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** Funding's job was made (its Safe's yes): what it adds and where from, until Done. */
  const [funded, setFunded] = useState<{ amount: string; from: string; endsAt: number; landedAt?: number } | null>(null);
  // W9-5b: its core's answer landed it: the receipt stops saying "About 10 s left" and "It keeps going" over money already there
  const fundedLanded = () => setFunded((f) => (f ? { ...f, landedAt: Date.now() } : f));
  const [why, setWhy] = useState<Receipt | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [checking, setChecking] = useState(false);
  const [words, setWords] = useState("");
  const [reading, setReading] = useState(false);
  const [fault, setFault] = useState<RuleFault | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [hasOwnKey, setHasOwnKey] = useState(false);
  const [readBy, setReadBy] = useState<"allowance" | "own-key" | null>(null);
  const [startsAtKept, setStartsAt] = useState<string | null>(null);
  const [computerAt, setComputerAt] = useState<string | null>(null);
  // "Ask me above $X" (FLOW-V5 §5 item 1): kept by the core on this device; undefined while it's read.
  const [askAbove, setAskAboveState] = useState<number | null | undefined>(undefined);
  /** The account's recovery wait, for the Its wallet sheet's wait in words (finding 47); null until read. */
  const [recoveryDelay, setRecoveryDelay] = useState<number | null>(null);
  useEffect(() => {
    void bridge.call<{ account?: { recovery?: { delaySeconds?: number } | null } }>("account.state").then((r) => {
      const d = "ok" in r ? r.ok.account?.recovery?.delaySeconds : undefined;
      if (typeof d === "number") setRecoveryDelay(d);
    });
  }, [bridge]);
  useEffect(() => {
    void bridge.call<{ askAboveUsd: number | null }>("account.agent.askAbove", {}).then((r) => "ok" in r && setAskAboveState(r.ok.askAboveUsd));
  }, [bridge]);
  // A-10: AgentZero's own name, agent.<you>.near (made by the account contract on the core's sheet; an identity, no money).
  const [identity, setIdentity] = useState<{ name: string | null; line: string | null; canMake: boolean } | null>(null);
  useEffect(() => {
    void bridge.call<{ name: string | null; line: string | null; canMake: boolean }>("account.agent.identity", {}).then((r) => "ok" in r && setIdentity(r.ok));
  }, [bridge]);
  const makeIdentity = async () => {
    const r = await bridge.call<{ name: string } | { declined: true }>("account.agent.identityCreate", {});
    if ("ok" in r && "name" in r.ok) setIdentity({ name: r.ok.name, line: null, canMake: false });
  };
  const chooseAsk = async (usd: number | null) => {
    const r = await bridge.call<{ askAboveUsd: number | null } | { declined: true }>("account.agent.askAbove", { set: true, usd });
    if ("ok" in r && "askAboveUsd" in r.ok) setAskAboveState(r.ok.askAboveUsd);
    setSheet(null);
  };
  useEffect(() => {
    void bridge.call<{ value: string | null }>("device.store.get", { key: COMPUTER_KEY }).then((r) => {
      try {
        const at = "ok" in r && r.ok?.value ? (JSON.parse(r.ok.value) as { atIso?: unknown }).atIso : null;
        if (typeof at === "string") setComputerAt(at);
      } catch {
        /* none kept */
      }
    });
  }, [bridge]);
  /** The Pay sheet's check on who gets paid (or why AgentZero can't), read when the sheet opens; shown before the tap. */
  const [payCheck, setPayCheck] = useState<{ warn?: string; cannot?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pocketBusy = useRef(false);
  const [choice, setChoice] = useState(POCKET_DEFAULT);
  // The latest of each, for the runner's timer.
  const live = useRef({ jobs, spent, agent, receipts });
  /** The Sim's send that "Who should get it?" asked about: the next words finish it (rule-home.ts). */
  const sendAsked = useRef<import("../zero/rule-home.ts").Typed | null>(null);
  live.current = { jobs, spent, agent, receipts };

  // S2: every read ends with an answer. The view gets POCKET_READ_MS; a slow price or engine never holds it up.
  const read = useCallback(async () => {
    setPocketRead((r) => (r.k === "unread" ? { k: "reading" } : r));
    const [view, tokens] = await Promise.all([
      readWithin(bridge.call("account.agent.view")),
      readWithin(bridge.call<{ assetId: string; priceUsd?: string }[]>("ledger.tokens")),
      engine.refresh().catch(() => undefined),
    ]);
    const price = typeof tokens === "object" && "ok" in tokens && Array.isArray(tokens.ok) ? Number(tokens.ok.find((t) => t.assetId === WNEAR_ID)?.priceUsd) || 0 : 0;
    setNearUsd(price);
    const got = pocketFrom(view as Parameters<typeof pocketFrom>[0]);
    setPocketRead(got);
    const state = got.k === "known" ? agentState(got.view, price) : null;
    setAgent(state);
    if (state && (POCKET_CHOICES as readonly number[]).includes(Math.round(state.limitUsd))) setChoice(Math.round(state.limitUsd));
    const without = got.k === "none";
    const rules = without ? await readWithin(bridge.call<{ current: number; update?: { waitSeconds: number; thenWaitSeconds?: number; listFirst?: true; waiting?: { readyAtIso: string } } }>("account.rules")) : null;
    const u = rules && typeof rules === "object" && "ok" in rules && rules.ok.current >= 10 ? rules.ok.update : undefined;
    setPocketUpdate(u ? { waitSeconds: u.waitSeconds, ...(u.thenWaitSeconds ? { thenWaitSeconds: u.thenWaitSeconds } : {}), ...(u.listFirst ? { listFirst: true } : {}), ...(u.waiting ? { readyAtIso: u.waiting.readyAtIso } : {}) } : null);
    const own = await readWithin(bridge.call<{ value: string | null }>("device.secret.get", { key: SECRETS.ownKey }));
    setHasOwnKey(typeof own === "object" && "ok" in own && !!own.ok?.value);
  }, [bridge, engine]);

  useEffect(() => {
    if (shell.active) void read();
  }, [shell.active, read]);

  const on = !!agent && agent.limitUsd > 0;
  // hunt (042, 6 Nov walk): what waits is the account's own answer in the Sim, so a Cancel in Waiting, a Stop or a reload
  // leaves no "Goes up to $50" and no lost "AgentZero starts" behind
  const raise = agent?.sample ? (on ? agent.waiting ?? null : null) : raiseKept;
  const startsAt = agent?.sample ? (on ? null : agent.waiting?.atIso ?? null) : startsAtKept;
  const pocketUsd = on ? agent.limitUsd : 0;
  const starts = (kind: JobKind) => jobStarts(kind, { sample: agent?.sample === true, pocket: !noPocket });
  // Safe pocket money only where the core grants that key (QA: never with AgentZero's own wallet on)
  const pocketHere = safeKeyOffered(agent?.sample === true);
  /** The limit a job sheet holds a job to: the Safe pocket money, or with none here, the copy job's SOL day. */
  const sheetPocketUsd = pocketHere ? (on ? pocketUsd : choice) : COPY_DAY_MOST;
  /** Why a job asked for can't start: no wallet on this account, or not offered at all. */
  const cannotLine = (kind: JobKind) => (jobOffered(kind, agent?.sample === true) ? NO_POCKET_LINE : NOT_OFFERED_LINE);
  const nowMs = Date.now();

  const addReceipts = useCallback((more: Receipt[]) => void engine.addReceipts(more), [engine]);

  /** One event for one job: the engine decides, carries it out with the core and writes the receipt. */
  const handle = useCallback(
    async (ev: Event) => {
      const a = await engine.handle(ev);
      if (a && (a.kind === "pay" || a.kind === "top-up" || a.kind === "buy")) void read();
    },
    [engine, read],
  );

  // The runner: AgentZero's engine looks every 30 s while ZeroFee is open, also after this tab is left (a keep job is
  // the person's standing ask; the engine polls nothing unless a keep job runs and can act). Started once the tab is shown.
  useEffect(() => {
    if (shell.active) engine.start();
  }, [shell.active, engine]);

  // Sign me in (D75): the site window's own lines, as AgentZero's receipts, while that job runs.
  useEffect(() => {
    const take = (s: AgentZeroStep) => {
      const job = live.current.jobs.find((j) => j.kind === "sign-in" && j.on);
      if (!job) return;
      addReceipts([makeReceipt({ kind: "note", jobId: job.id, line: s.line }, Date.parse(s.atIso) || Date.now(), [`Job: ${jobTitle("sign-in")}.`, `On ${s.site}: ${s.line}`, "AgentZero used the site's own wallet. No money moved."])]);
    };
    return onAgentZeroStep(take);
  }, [addReceipts]);

  const saveJobs = (next: (js: Job[]) => Job[]) => void engine.saveJobs(next);

  /** Turn AgentZero on, or change its its wallet: the core's Approve. True when it is on (or waiting to start). */
  /** `anyAddress`: a running (or starting) job needs the any-address cap (M4: only a pay list or a keep job). */
  // hunt 5 Nov (027/030): the list a limit change sends is the running pay list's, never the account's old one, so a
  // stopped list doesn't come back on the next Approve
  const setPocket = async (usd: number, people: readonly string[] = runningList(jobs), anyAddress = needsAnyAddress(jobs), fund = false): Promise<boolean> => {
    // hunt 5 Nov (013/014): a second click before `busy` re-rendered opened a second approval sheet
    if (pocketBusy.current) return false;
    pocketBusy.current = true;
    try {
      return await setPocketOnce(usd, people, anyAddress, fund);
    } finally {
      pocketBusy.current = false;
    }
  };
  const setPocketOnce = async (usd: number, people: readonly string[], anyAddress: boolean, fund = false): Promise<boolean> => {
    setBusy(true);
    const method = on ? "account.agent.setBudget" : "account.agent.set";
    // funding (QA's Sim test Nov: no "Job created.", no time, nothing said where the $10 came from): the job is made
    // on the Safe's yes (its Face ID), as a site's Add is (job-run.ts onOwnApproval), with its source and its time
    const f = fund ? fundJob(usd, Math.max(0, usd - pocketUsd)) : null;
    let job: JobHandle | null = null;
    const stop = f ? onOwnApproval((yes) => { if (yes && !job) { job = startMoneyJob(shell.tasks, f.job); job.approved(); setFunded({ ...f.said, endsAt: Date.now() + f.job.etaSec * 1000 }); } }, { anySheet: true }) : () => {};
    // USDC only, the listed people only (security design review H1, H2): budget.ts.
    const r = await bridge.call<TxOutcome>(method, { limitUsd: usd, people: [...people], budget: zeroBudget(usd, people, Date.now(), on ? agent?.endsAtNs : undefined, { anyAddress: AGENT_PRIVATE_ROUTE && anyAddress }), orders: [] }).finally(stop);
    setBusy(false);
    const j = job as JobHandle | null;
    // the job's row ends with the core's answer: done in place (no live row takes it over), or its refusal's words (rule 8)
    if (j) {
      if ("problem" in r) shell.tasks?.end(j.id, "failed", r.problem.whatHappened);
      else if (r.ok.status === "done") shell.tasks?.end(j.id, "done", FUND_JOB_WORDS.done);
      else if (r.ok.status === "waiting") j.made([]);
      else if (r.ok.status === "declined") j.gone();
      else shell.tasks?.end(j.id, "failed", r.ok.status === "problem" ? r.ok.problem.whatHappened : FUND_JOB_WORDS.stopped);
      if ("ok" in r && r.ok.status === "done") fundedLanded();
      else setFunded(null);
    }
    if ("problem" in r) {
      // S2: the account's rules have no its wallet after all (release 9): say so in AgentZero's words, never "isn't
      // ready yet", and offer from now on only what works without it.
      if ((r.problem as Problem).code === "security.method.unknown") {
        setPocketRead({ k: "none" });
        setSheet({ kind: "said", line: NO_POCKET_LINE });
        return false;
      }
      void shell.showProblem(r.problem as Problem);
      return false;
    }
    if (r.ok.status === "waiting") {
      // on already: a higher limit waits, the one in force stays (the row says both); off: AgentZero starts then
      if (on) setRaise({ usd, atIso: r.ok.readyAtIso });
      else setStartsAt(r.ok.readyAtIso);
      await read();
      return true;
    }
    if (r.ok.status !== "done") {
      if (r.ok.status === "problem") void shell.showProblem(r.ok.problem);
      return false;
    }
    await read();
    return true;
  };

  /**
   * Test and the review (5 Nov): with AgentZero's own wallet on (a real account), the core refuses
   * account.agent.set / setBudget (agent-door.ts SAFE_KEY_DOORS), so the funding page's Add made nothing. The real fill
   * is the core's wallet fill on the person's own trusted tap (wallet-fill.ts fillOnTap), run as a job: its row on Home
   * and in Activity, and "Job created." with the time left, at the tap (job-run.ts runJob). The same path the web's
   * AgentWallet takes (apps/web use-agent-wallet.ts fund).
   */
  const fillOwn = async (usd: number, tap: unknown): Promise<void> => {
    if (pocketBusy.current) return;
    pocketBusy.current = true;
    setBusy(true);
    try {
      const t = shell.tasks as Partial<Tasks> | undefined;
      const tasks = t && typeof t.publish === "function" && typeof t.update === "function" && typeof t.end === "function" ? (t as Tasks) : undefined;
      // one funding receipt (main's az-fund-made sheet): "Job created.", where the money comes from, its time left
      const f = fillFundJob(usd);
      const end = await fillJob({ bridge, tasks, usd, tap, key: `agent-fill-${Date.now().toString(36)}`, made: () => { setSheet(null); setFunded({ ...f.said, endsAt: Date.now() + f.job.etaSec * 1000 }); } });
      if ("refused" in end) { setFunded(null); void shell.showProblem(end.refused); }
      else if ("declined" in end || "problem" in end) setFunded(null); // a no takes the row away; a refusal's row says why (rule 8)
      else { tasks?.end(end.job.id, "done", FUND_JOB_WORDS.done); fundedLanded(); void read(); }
    } finally {
      pocketBusy.current = false;
      setBusy(false);
    }
  };

  // hunt (013/014, 6 Nov): a second click before the screen redraws: one job, one Stop, one payment, never two sheets
  const acting = useRef(false);
  const once = oneAtATime(acting);
  // a kill switch has its own gate: a Start that hangs never swallows a Stop (audit, 6 Nov)
  const stopping = useRef(false);
  const onceStop = oneAtATime(stopping);
  const [stopBusy, setStopBusy] = useState(false);

  const startJob = async (terms: JobTerms) => {
    // The pay list lives on the account (budget.recipients): starting it is the core's Approve, on or off. Another
    // money job turns AgentZero on if it is off; the sign-in job moves no money.
    if (terms.kind === "pay-list") {
      if (!(await setPocket(on ? pocketUsd : choice, terms.people, AGENT_PRIVATE_ROUTE))) return;
    } else if (terms.kind === "keep" && AGENT_PRIVATE_ROUTE && !live.current.agent?.sample) {
      // D89: a private top-up pays a fresh 1Click address, so the budget's any-address cap opens while it runs (waits
      // the safety wait on an existing account; the row says until when).
      if (!(await setPocket(on ? pocketUsd : choice, agent?.people ?? [], true))) return;
    } else if (!on && pocketHere && terms.kind !== "sign-in" && !(await setPocket(choice))) return;
    // P3/P4, D117: a copy job on a real account trades from the person's SOL row, inside one day they approve now (one
    // Face ID, up to 24 h). No day, no job.
    let pocketLine: string | null = null;
    if (terms.kind === "copy" && !live.current.agent?.sample) {
      const pocket = await bridge.call<{ id: string; address: string }>("account.agent.pocket");
      if (!("ok" in pocket)) return void shell.showProblem(pocket.problem as Problem);
      const day = await bridge.call<{ endsAtIso: string } | { declined: true }>("account.agent.pocketSession", { perTxUsd: Math.min(terms.perTradeUsd, 5), totalUsd: Math.min(Math.max(terms.perDayUsd, terms.perTradeUsd), COPY_DAY_MOST), minutes: 24 * 60 });
      if (!("ok" in day)) return void shell.showProblem(day.problem as Problem);
      if ("declined" in day.ok) return;
      pocketLine = "AgentZero trades from your SOL wallet. Add SOL to it from Home.";
    }
    const at = Date.now();
    const job = { ...terms, id: newJobId(at), startedAtIso: new Date(at).toISOString(), on: true } as Job;
    // One job of each kind: a new one replaces the old.
    saveJobs((js) => [job, ...js.filter((j) => j.kind !== terms.kind)]);
    addReceipts([makeReceipt({ kind: "note", jobId: job.id, line: `Started: ${jobTitle(job.kind)}.` }, at, [`Job: ${jobTitle(job.kind)}.`, startSheet(terms, { agentOn: true, pocketUsd: choice, sample: live.current.agent?.sample }).lines[0], "You started it with one tap.", ...(pocketLine ? [pocketLine] : [])])]);
    setSheet(null);
    setWords("");
    if (part === "ask" || part === "sheet") onClose?.();
    // The web demo's sample shows a job at work at once: the sample leader's first buy.
    if (job.kind === "copy" && live.current.agent?.sample) setTimeout(() => void handle({ kind: "leader-buy", jobId: job.id, ...SAMPLE_BUYS[0], signature: "sample" }), 1500);
    if (job.kind === "keep") setTimeout(() => void engine.tick(), 300);
    if (job.kind === "sign-in") for (const s of agentZeroSteps().slice(0, 3)) void handle({ kind: "site-step", jobId: job.id, site: s.site, line: s.line });
  };

  const stopJob = async (job: Job) => {
    saveJobs((js) => js.map((j) => (j.id === job.id ? { ...j, on: false } : j)));
    // The copy job's day ends with it, at once (D107).
    if (job.kind === "copy") void bridge.call("account.agent.pocketEnd");
    setSheet(null);
    // The list comes off the account too: a tighter budget, at once (one Approve). The job stops here either way, and
    // the receipt says what really happened on the account (review L6).
    const why = [`Job: ${jobTitle(job.kind)}.`, "You stopped it. AgentZero won't pay for it from here."];
    // A looser budget still held for its safety wait goes with the stop (review M4): it would open the cap later otherwise.
    // The core cancels only AgentZero's own budget changes (account.agent.cancelWaiting), each on its own Cancel sheet.
    // Always asked (review A: the screen's own record of a waiting change is gone after a reload); 0 when none waits.
    if (job.kind === "pay-list" || job.kind === "keep") {
      const c = await bridge.call<{ cancelled: number; outcomes?: TxOutcome[] }>("account.agent.cancelWaiting");
      // hunt 5 Nov (034): a check that didn't answer is not a change still waiting; it says so
      const left = "ok" in c ? (c.ok.outcomes ?? []).length - c.ok.cancelled : 0;
      if ("ok" in c && c.ok.cancelled > 0) {
        setStartsAt(null);
        setRaise(null);
        void read();
        why.push("The change still waiting on your account was cancelled.");
      }
      if (!("ok" in c)) why.push("NEAR didn't answer. A change may still be waiting. Look in Waiting.");
      if (left > 0) why.push("A change is still waiting on your account. Cancel it in Waiting, or stop AgentZero.");
    }
    const others = jobs.filter((j) => j.id !== job.id);
    // M4: the any-address cap closes with the last job that needs it, at once (a tighter budget).
    if (job.kind === "keep" && on && !agent?.sample && (agent?.anyAddressUsd ?? 0) > 0 && !needsAnyAddress(others)) {
      const off = await setPocket(pocketUsd, runningList(others), false);
      why.push(off ? "You closed AgentZero's top-up limit." : "AgentZero's top-up limit is still on your account. To close it, stop AgentZero.");
    }
    if (job.kind === "pay-list" && on && (agent?.people.length ?? 0) > 0) {
      const off = await setPocket(pocketUsd, [], needsAnyAddress(others));
      why.push(off ? "You approved taking your list off your account." : "Your list is still on your account. To take it off, stop AgentZero.");
    }
    addReceipts([makeReceipt({ kind: "note", jobId: job.id, line: `Job off: ${jobTitle(job.kind)}.` }, Date.now(), why)]);
  };

  const stopAll = async () => {
    setBusy(true);
    setStopBusy(true);
    const r = await bridge.call<TxOutcome>("account.agent.revoke");
    setBusy(false);
    setStopBusy(false);
    if ("problem" in r) return void shell.showProblem(r.problem as Problem);
    if (r.ok.status !== "done") return;
    saveJobs((js) => js.map((j) => ({ ...j, on: false })));
    // Its key is gone on chain, so a paired computer can't use it any more: the row goes too (review).
    setComputerAt(null);
    void bridge.call("device.store.set", { key: COMPUTER_KEY, value: JSON.stringify({}) });
    // agent_revoke drops a raise still waiting (agent.rs): the row stops promising it, and the next Turn on offers the
    // limit that was in force, not the dropped raise (hunt 5 Nov, 042)
    setRaise(null);
    if (on && (POCKET_CHOICES as readonly number[]).includes(Math.round(pocketUsd))) setChoice(Math.round(pocketUsd));
    const back = agent?.sample ? agent.heldUsd ?? 0 : 0;
    addReceipts([makeReceipt({ kind: "note", jobId: "", line: "Stopped AgentZero. Its key is off your account." }, Date.now(), ["You stopped AgentZero.", "Its key came off your account. Every job stopped.", ...(back > 0 ? [STOP_BACK_DONE(back)] : []), "Your receipts stay here."])]);
    setSheet(null);
    setStartsAt(null);
    await read();
  };

  /** The rule box: words → one sheet. */
  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || reading) return;
    // test: the words leave the box when sent; they stay on the sheet ("You said: …"), never in the box
    setWords("");
    setReading(true);
    // The own key and the sign-up's token come out of the keychain for this one call only.
    const secret = async (key: string) => {
      const r = await bridge.call<{ value: string | null }>("device.secret.get", { key });
      return "ok" in r ? (r.ok?.value ?? null) : null;
    };
    // The Sim (QA walk, 5 Nov, 036/038): what you hold and a send are read on the page and answered by the chat's own
    // code over the Sim's money (rule-home.ts): the holdings, or Home's Send opened filled in. Jobs go on below.
    // The trust boundary (QA): `t` is the word box's own text (its form's submit is ask's one caller), so it is
    // the only thing typedByPerson marks; a send's payee is read from it and the send kept from it, never from a tool, a
    // mail, a page or a model (rule-home.ts Turn).
    if (live.current.agent?.sample) {
      const before = sendAsked.current;
      sendAsked.current = null;
      const home = await import("../zero/rule-home.ts").then((m) => m.answerOnPage({ typed: m.typedByPerson(t) }, before, bridge)).catch(() => null);
      if (home) {
        setReading(false);
        if (home.kind === "send") {
          setSheet(null);
          return void shell.openMoney(home.ask);
        }
        if (home.pending) sendAsked.current = home.pending;
        return void setSheet({ kind: "said", line: home.lines.join("\n"), words: t });
      }
    }
    // The Sim reads on this device (the product prepaid rule, 4 Nov: AgentZero thinks only on money it holds, and the Sim
    // holds none; UX hunt 5 Nov, 077: a first Sim job got "Your free Claude reading is used up"). Real accounts: the relay.
    const relay = live.current.agent?.sample ? null : RELAY;
    const res = await readJob(t, {
      relayBase: relay,
      fetch: ((url: string, init: RequestInit) => fetch(url, init)) as never,
      ownKey: await secret(SECRETS.ownKey),
      token: relay ? await secret(SECRETS.token) : null,
      saveToken: async (token) => void (await bridge.call("device.secret.set", { key: SECRETS.token, value: token })),
      // the job sheet's own limit (JobSheet's pocketUsd): a limit the words don't name starts there, so it fits (078)
      pocketUsd: sheetPocketUsd,
    });
    const rd = res.reading;
    setReading(false);
    setFault(res.fault);
    setReadBy(res.paidBy);
    if (res.allowance) setAllowance(res.allowance);
    if (rd.kind === "job") setSheet(starts(rd.terms.kind) ? { kind: "job", terms: rd.terms, said: { words: t, by: rd.by } } : { kind: "cannot", line: cannotLine(rd.terms.kind), words: t });
    else if (rd.kind === "pay") openPay(rd.to, rd.usd, t);
    else if (rd.kind === "routine") setSheet({ kind: "routine", terms: rd.terms });
    else setSheet({ kind: "cannot", line: rd.line, words: t });
  };

  /** The Pay once sheet, offered like a Chat request with its own id: the tap on its Pay pays only this (M2). */
  function openPay(to: string, usd: number, words: string) {
    // D116: where AgentZero can't pay anyone yet, no Pay once sheet at all (its Pay could never work); the way that does.
    if (!jobOffered("pay-list", agent?.sample === true)) return void setSheet({ kind: "said", line: noPayLine(to, usd) });
    if (!starts("pay-list")) return void setSheet({ kind: "said", line: NO_POCKET_LINE });
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setPayCheck(null);
    setSheet({ kind: "pay", to, usd, words, id });
    void engine.offer({ requestId: id, to, usd }).then((o) => setPayCheck(o.ok ? (o.warn ? { warn: o.warn } : {}) : { cannot: o.line }));
  }

  /** The Pay once sheet's button: `tap` is its click (M2: AgentZero pays only on the person's own tap on this sheet). */
  const payOnce = async (id: string, to: string, usd: number, tap: unknown) => {
    const job = jobs.find((j) => j.kind === "pay-list" && j.on);
    setSheet(null);
    setWords("");
    if (!job) return void setSheet({ kind: "job", terms: { ...(defaultTerms("pay-list", on ? pocketUsd : choice) as Extract<JobTerms, { kind: "pay-list" }>), people: [to] } });
    const done = await engine.payRequest({ requestId: id, to, usd }, tap);
    if (done.kind === "paid") void read();
    // Anything but a payment says why, in place of the sheet (review C: it closed silently).
    else setSheet({ kind: "cannot", line: done.line, words: "" });
  };

  const showProof = async () => {
    setChecking(true);
    try {
      setProof(await attest(MODEL));
    } catch (e) {
      await shell.showProblem({ code: "agent.nearai.proof", whatHappened: e instanceof NearAiError ? e.message : "NEAR AI Cloud didn't send its proof.", money: SAFE, next: { kind: "nothing", label: "OK" } } as Problem);
    } finally {
      setChecking(false);
    }
  };

  // The chat's ChatSheetCard (part "sheet"): open the sheet it was given once AgentZero's state has loaded, and say when
  // it's closed. Money still moves only on the person's own tap on that sheet (M2).
  // The chat's act, on the person's own tap: the core's act-scope sheet first (its dry run, Face ID; on the web D103's
  // check), then the act through the core's door, which checks the scope, "Ask me first" and the guard, and counts it
  // before anything is signed. Whatever the core refuses is said in its own words.
  const runAct = async (a: ChatAct) => {
    setBusy(true);
    try {
      const done = await runChatAct(bridge, engine.act, a, `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      setSheet({ kind: "said", line: done.line });
    } finally {
      setBusy(false);
    }
  };

  const opened = useRef(false);
  useEffect(() => {
    if (part !== "sheet" || !open || opened.current || agent === undefined) return;
    opened.current = true;
    if (open.kind === "job") setSheet(starts(open.terms.kind) ? { kind: "job", terms: open.terms } : { kind: "cannot", line: cannotLine(open.terms.kind), words: "" });
    else if (open.kind === "pay") openPay(open.to, open.usd, "");
    else if (open.kind === "stop-job") {
      const running = jobs.find((j) => j.kind === open.job && j.on);
      setSheet(running ? { kind: "job", terms: running } : { kind: "cannot", line: "That job isn't running.", words: "" });
    } else if (open.kind === "act") setSheet({ kind: "act", act: open.act, from: open.from, to: open.to, usd: open.usd });
    else if (open.kind === "routine") setSheet({ kind: "routine", terms: open.terms });
    else setSheet({ kind: "said", line: CANT_YET });
  }, [part, open, agent, jobs]);
  useEffect(() => {
    if (part === "sheet" && opened.current && sheet === null) onClose?.();
  }, [part, sheet, onClose]);

  if (proof) {
    return (
      <PushedFrame name="Proof" onBack={() => setProof(null)}>
        <div className="ag">
          <div className="ag-head">
            <div className="zf-label">NEAR AI Cloud</div>
            <h1 className="zf-title">{proof.ok ? "A sealed computer, checked now" : "The proof didn't check out"}</h1>
            <p className="zf-small">ZeroFee sent a fresh number. The sealed computer had to sign it.</p>
          </div>
          <div className="ag-rows">
            {proof.checks.map((c) => (
              <div className="ag-row" key={c.label}><span className="t">{c.label}</span><span className="v">{c.ok ? "✓" : "✗"}</span></div>
            ))}
          </div>
          <p className="zf-small" style={{ marginTop: 14 }}>{proof.notHere}</p>
        </div>
      </PushedFrame>
    );
  }

  if (why) {
    // Item 4: "sealed" only after this device checked the stored proof and the signature again (zero/attest-line.ts).
    const sealed = checkedLine(why.check);
    return (
      <PushedFrame name="Why" onBack={() => setWhy(null)}>
        <div className="ag">
          <div className="ag-head">
            <div className="zf-label">{receiptTime(why.atIso, nowMs)}</div>
            <h1 className={`zf-title${why.state === "refused" ? " ag-refused" : ""}`}>{why.title}</h1>
          </div>
          <div className="ag-rows">
            {why.why.filter((l) => !l.endsWith(":")).map((l) => (
              <div className="ag-row" key={l}><span className="t">{l}</span></div>
            ))}
            {why.check && (
              <div className="ag-row"><span><span className="t">{why.check.verdict === "allow" ? "Checked before it paid ✓" : why.check.verdict === "warn" ? "Checked before it paid" : "Refused by the check"}</span><span className="d">{`${why.check.line} ${sealed?.proof ? SEALED : `Checked on ${thisDevice()}.`}`}</span></span></div>
            )}
            {sealed?.proof && (
              <div className="ag-row"><span><span className="t">The proof</span><span className="d">{`Signed by ${sealed.proof.model}: ${sealed.proof.signature.slice(0, 18)}…`}</span></span></div>
            )}
            {why.txHash && !why.txHash.startsWith("sample") && (
              <a className="ag-row" href={`https://nearblocks.io/txns/${why.txHash}`} target="_blank" rel="noreferrer"><span className="t">See it on NEAR's public record</span><span className="v">›</span></a>
            )}
            {why.txHash?.startsWith("sample") && <div className="ag-row"><span className="t">Sample money. Nothing real moved.</span></div>}
            {logLine(why, receipts) && <div className="ag-row"><span className="t">{logLine(why, receipts)}</span></div>}
            <button className="ag-row" disabled={checking} onClick={() => void showProof()}>
              <span><span className="t">Checks on a locked computer</span><span className="d">{checking ? "Getting the proof…" : "Not even ZeroFee can look inside. Tap to see proof."}</span></span><span className="v">›</span>
            </button>
          </div>
        </div>
      </PushedFrame>
    );
  }

  const jobOf = (kind: JobKind) => jobs.find((j) => j.kind === kind && j.on);
  const today = spentToday({ nowMs, pocketUsd, spent });

  return (
    <Frame part={part}>
      <div className="ag">
        {/* concept v3.1 (5 Nov); product decision, 5 Nov: what AgentZero does and its fee line lead the page, then the field */}
        {part === "all" && <div className="ag-head" />}
        {/* product decision, 5 Nov: the page leads with what AgentZero really does here, and its fee line (AzLead.tsx) */}
        {settles && <AzLead copy={starts("copy")} pocket={!noPocket} />}

        {asks && (<>
        <form className="ag-ask" onSubmit={(e) => { e.preventDefault(); void ask(words); }}>
          <textarea aria-label="Give AgentZero a job" rows={1} value={words} placeholder="Give AgentZero a job" onChange={(e) => setWords(e.target.value)} />
          <button className="ag-send" type="submit" disabled={!words.trim() || reading} aria-label="Read my job"><Send /></button>
        </form>
        <p className="zf-small ag-under">{reading ? "Claude is reading your job…" : fault ? fault.line : readBy === "own-key" ? "Read by Claude with your own key." : readBy === "allowance" && allowance ? `Read by Claude. Free reading used: ${dollars(allowance.usedUsd)} of ${dollars(allowance.limitUsd)}.` : "Say a job in your words. You get one sheet to check."}</p>
        </>)}
        {settles && (<>

        <div className="zf-label ag-section">Jobs</div>
        <div className="ag-rows ag-rows--tight">
          {JOB_ORDER.filter((k) => starts(k) || !!jobOf(k)).map((kind) => {
            const job = jobOf(kind);
            const waiting = listWaiting(job, agent && !agent.sample ? agent.people : null);
            return (
              <button key={kind} className="ag-row ag-row--job" onClick={() => setSheet({ kind: "job", terms: job ?? defaultTerms(kind, on ? pocketUsd : choice) })}>
                <span className="ag-glyph" aria-hidden="true">{JOB_GLYPH[kind]}</span>
                <span><span className="t">{jobTitle(kind)}</span><span className="d">{jobLine(kind, job, on ? pocketUsd : choice, waiting)}</span></span>
                <span className="v">{job ? (waiting ? "Waiting ›" : "On ›") : "Start ›"}</span>
              </button>
            );
          })}
        </div>

        {/* the person's own Claude key: a developer build only (chat/own-key.ts); people think on AgentZero's funded wallet */}
        {OWN_KEY_ON && (
          <button className="ag-row" onClick={() => setSheet({ kind: "key" })}>
            <span><span className="t">{hasOwnKey ? "Claude Opus 5.5: your own key" : RELAY ? "Claude Opus 5.5: free to try" : "Claude Opus 5.5: add your key"}</span><span className="d">{hasOwnKey ? `${KEPT} ${ThisDevice()} asks Anthropic itself. You pay Anthropic.` : RELAY ? "On ZeroFee's key, with a free amount. Add your own key any time." : `Without a key, AgentZero reads your words on ${thisDevice()}.`}</span></span>
            <span className="v">›</span>
          </button>
        )}

        {/* UI audit 5 Nov: AgentZero's own settings rows (its name, a computer, Ask me first) in one card, like every
            other list on the page, never loose rows between the cards */}
        {on && <div className="ag-rows ag-rows--more">
        {/* A-10: AgentZero's own name, once the account can make it; the line otherwise. */}
        {/* Hidden until release 11 is live on the account (QA: no row that says "comes with the next update"). */}
        {on && !agent?.sample && identity && (identity.name || identity.canMake) && (
          identity.canMake ? (
            <button className="ag-row" onClick={() => void makeIdentity()}>
              <span><span className="t">Give AgentZero its own name</span><span className="d">A name others can pay and check. It holds no money.</span></span>
              <span className="v">›</span>
            </button>
          ) : (
            <div className="ag-row"><span><span className="t">{identity.name ? "AgentZero's name" : "AgentZero's own name"}</span><span className="d">{identity.name}</span></span></div>
          )
        )}

        {/* D100/D101: AgentZero on the person's own computer (Claude Code, Codex, Cursor attach to it there). */}
        {on && !agent?.sample && (
          <button className="ag-row" onClick={() => setSheet({ kind: "computer" })}>
            <span>
              <span className="t">{computerAt ? "AgentZero on a computer" : "Use AgentZero on a computer"}</span>
              <span className="d">{computerAt ? `Paired ${new Date(computerAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Stop AgentZero to stop it there too.` : "Claude Code on your computer can use AgentZero, from its own wallet."}</span>
            </span>
            <span className="v">›</span>
          </button>
        )}

          <button className="ag-row" onClick={() => setSheet({ kind: "ask" })}>
            <span>
              <span className="t">Ask me first</span>
              <span className="d">{askAbove === undefined ? "" : askAbove === null ? ownWalletWords().askOff : askAbove === 0 ? "For every payment." : `Above ${dollars(askAbove)}.`}</span>
            </span>
            <span className="v">›</span>
          </button>
        </div>}

        {/* routines the person approved (real-Claude walk, 3 Nov: one approved in the chat was listed nowhere and
            couldn't be stopped); each from the phone's store, with Stop */}
        {(snap.routines ?? []).some((r) => r.on) && (
          <>
            <div className="zf-label ag-section">Routines</div>
            <div className="ag-rows ag-rows--tight">
              {(snap.routines ?? []).filter((r) => r.on).map((r) => (
                <div key={r.id} className="ag-row">
                  <span><span className="t">{whenWords(r.when)}</span><span className="d">{doWords(r.do, r.limitUsd)}</span></span>
                  <button className="zf-link" aria-label={`Stop the routine: ${whenWords(r.when)}`} disabled={busy} onClick={() => void engine.stopRoutine(r.id)}>Stop</button>
                </div>
              ))}
            </div>
          </>
        )}

        {noPocket && !pocketUpdate && (
          // S2/S3: why there's no Its wallet or Turn on here, said once, instead of rows that come and go unexplained
          <div className="ag-rows ag-rows--tight">
            <div className="ag-row"><span className="d">{NO_POCKET_LINE}</span></div>
          </div>
        )}
        {!noPocket && pocketHere && (<>
        <div className="zf-label ag-section">Wallet</div>
        <div className="ag-rows ag-rows--tight">
          <button className="ag-row" disabled={pocket.k === "reading"} onClick={() => (pocket.k === "unread" ? void read() : offersTurnOn(pocket) ? setSheet({ kind: "pocket" }) : undefined)}>
            <span>
              <span className="t">{walletRow(on ? agent.heldUsd ?? Math.max(0, Math.round((pocketUsd - Math.max(today, agent.spentUsd)) * 100) / 100) : 0)}</span>
              <span className="d">{pocket.k === "reading" ? "Looking at your account…" : pocket.k === "unread" ? (pocket.problem?.whatHappened ?? POCKET_UNREAD_LINE) : on && raiseShown(raise, on, pocketUsd) ? `Goes up to ${dollars(raise!.usd)} on ${new Date(raise!.atIso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}. Spent so far: ${dollars(Math.max(today, agent.spentUsd))}.` : on && agent.pausedUntilIso ? pausedLine(agent.pausedUntilIso) : on ? `Spent so far: ${dollars(Math.max(today, agent.spentUsd))}.${ownWalletWords().row ? ` ${ownWalletWords().row}` : ""}` : startsAt ? `AgentZero starts ${new Date(startsAt).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.` : "Off. Fund it to turn AgentZero on."}</span>
            </span>
            <span className="v">›</span>
            {on && pocketUsd > 0 && <span className="ag-meter" aria-hidden="true"><i style={{ "--w": `${Math.min(100, (today / pocketUsd) * 100)}%` } as CSSProperties} /></span>}
          </button>
        </div>

        {on && (agent?.anyAddressUsd ?? 0) > 0 && !needsAnyAddress(jobs) && (
          // M4: a job that stopped by itself can't sign the tightening; the person closes the cap with one Approve.
          <div className="ag-rows ag-rows--tight">
            <button className="ag-row alert" disabled={busy} onClick={() => void setPocket(pocketUsd, agent?.people ?? [], false)}>
              <span><span className="t">Close AgentZero's top-up limit</span><span className="d">No job needs it now. One Approve closes it.</span></span>
              <span className="v">›</span>
            </button>
          </div>
        )}

        </>)}

        {noPocket && pocketUpdate && (
          <div className="ag-rows ag-rows--tight">
            <button className="ag-row" onClick={() => shell.openApp("security", "devices")}>
              <span><span className="t">{POCKET_UPDATE_TITLE}</span><span className="d">{pocketUpdateLine(pocketUpdate)}</span></span>
              <span className="v">›</span>
            </button>
          </div>
        )}

        <div className="zf-label ag-section">Receipts</div>
        <div className="ag-rows ag-rows--tight">
          {receipts.length === 0 && replies.length === 0 && <div className="ag-row"><span className="d">Nothing yet. Everything AgentZero does shows here.</span></div>}
          {pageRows(receipts, replies).map((x) => x.kind === "receipt" ? (
            <button key={x.r.id} className={`ag-row${x.r.state === "refused" ? " alert" : ""}`} onClick={() => setWhy(x.r)}>
              <span><span className="t">{x.r.title}</span><span className="d">{receiptTime(x.r.atIso, nowMs)}</span></span>
              <span className="v">Why ›</span>
            </button>
          ) : (
            // a paid reply: its receipt (with its NEAR transaction) is in Activity
            <button key={x.r.id} className="ag-row" onClick={() => shell.tasks?.open({ app: "agentzero" })}>
              <span><span className="t">{x.r.title}</span><span className="d">{receiptTime(new Date(x.r.atMs).toISOString(), nowMs)}</span></span>
              <span className="v">{x.r.usd ? `${x.r.usd} ›` : "›"}</span>
            </button>
          ))}
        </div>
        {shell.tasks && (
          // QA 5 Nov: the page had no way to Activity, where every receipt's proof is
          <button className="zf-link ag-activity" onClick={() => shell.tasks?.open({ app: "agentzero" })}>See all in Activity</button>
        )}

        {below}

        {!PHONE && !onDemoPage() && (
          <p className="zf-small ag-under ag-web">In a browser, AgentZero's key stays here, encrypted. You approve on the sheet, not with Face ID. Its jobs run while this tab is open.</p>
        )}

        <div className="ag-floor">
          {on || startsAt ? (
            <button className="zf-link ag-stop" onClick={() => setSheet({ kind: "stop" })}>Stop AgentZero</button>
          ) : !offersTurnOn(pocket) ? null : !pocketHere ? (
            // AgentZero's own wallet (a real account): funded by the core's wallet fill, never the Safe's key (fillOwn)
            <button className="zf-btn" disabled={busy} data-testid="ag-fund-own" onClick={() => setSheet({ kind: "pocket" })}>{FUND_BUTTON}</button>
          ) : (
            <button className="zf-btn" disabled={busy} onClick={() => setSheet({ kind: "pocket" })}>{FUND_BUTTON}</button>
          )}
        </div>
        </>)}
      </div>

      {sheet?.kind === "ask" && (
        <Sheet title="Ask me first" onClose={() => setSheet(null)}>
          <p className="zf-small">Above this, AgentZero doesn't pay. It asks you, and you pay it yourself.</p>
          <div className="ag-rows" role="radiogroup" aria-label="Ask me first">
            {([0, 1, 5, 20, null] as const).map((c) => (
              <button key={String(c)} className="ag-row" role="radio" aria-checked={askAbove === c} onClick={() => void chooseAsk(c)}>
                <span className="t">{c === null ? "Never" : c === 0 ? "Every payment" : `Above ${dollars(c)}`}</span><span className="v">{askAbove === c ? "✓" : ""}</span>
              </button>
            ))}
          </div>
          <p className="zf-small ag-under">Asking less often needs Face ID. Asking more often works at once.</p>
        </Sheet>
      )}

      {sheet?.kind === "pocket" && (
        // product decision, 5 Nov: the funding page. What the wallet is, what a job costs at the model's own price, who is paid
        // (Anthropic, the chain), and that ZeroFee takes nothing. No daily price. The account still holds AgentZero's key
        // to the amount picked here (the contract's cap over 24 hours); only the words changed.
        <Sheet title={FUND_TITLE} onClose={() => setSheet(null)}>
          {(() => {
            const w = fundLines();
            return (
              <>
                <div className="ag-rows">{w.what.map((l) => <div key={l} className="ag-row"><span className="t">{l}</span></div>)}</div>
                <div className="zf-label ag-section">What a job costs</div>
                <div className="ag-rows">{w.cost.map((l) => <div key={l} className="ag-row"><span className="t">{l}</span></div>)}</div>
                <div className="zf-label ag-section">Who you pay</div>
                <div className="ag-rows">{w.who.map((l) => <div key={l} className="ag-row"><span className="t">{l}</span></div>)}</div>
              </>
            );
          })()}
          <div className="zf-label ag-section">How much</div>
          <div className="ag-pick" role="radiogroup" aria-label="How much">
            {addable(FUND_AMOUNTS, on && pocketHere ? pocketUsd : 0).map((c) => (
              <button key={c} className={`ag-chip${choice === c ? " on" : ""}`} role="radio" aria-checked={choice === c} onClick={() => setChoice(c)}>{`$${c}`}</button>
            ))}
          </div>
          {pocketHere && <p className="zf-small ag-under">{pocketWaitLine(recoveryDelay, agent ? pocketAtOnce({ on, sample: agent.sample, limitUsd: pocketUsd, ...(agent.lastLimitUsd !== undefined ? { lastLimitUsd: agent.lastLimitUsd } : {}), choiceUsd: choice }) : undefined)}</p>}
          <div className="ag-sheet-floor">
            {pocketHere ? (
              <button className="zf-btn" disabled={busy || !(choice > (on ? pocketUsd : 0)) || agent?.waiting?.usd === choice} onClick={() => void setPocket(choice, runningList(jobs), needsAnyAddress(jobs), true).then((ok) => ok && setSheet(null))}>{ADD_BUTTON}</button>
            ) : (
              // the real fill: the core checks this trusted tap on the element marked with its amount (wallet-fill.ts)
              <button className="zf-btn" disabled={busy} data-agentzero-fill={String(Math.round(choice * 1e6))} onClick={(e) => void fillOwn(choice, e.nativeEvent)}>{ADD_BUTTON}</button>
            )}
          </div>
        </Sheet>
      )}

      {/* funding is a job (rule 2): "Job created." on the Safe's yes, where the money comes from, and its time left */}
      {funded && (
        <Sheet title={FUND_TITLE} onClose={() => setFunded(null)}>
          <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid="az-fund-made">
            <p className="zf-receipt__amount">{funded.amount}</p>
            <p className="zf-receipt__head">{JOB_WORDS.created}</p>
            <p className="zf-receipt__line" data-testid="az-fund-from">{funded.from}</p>
            <p className="zf-receipt__line" data-testid="job-time-left">{receiptLeft(funded.endsAt, Date.now(), undefined, funded.landedAt)}</p>
            {watchShown(funded.landedAt) && <p className="zf-receipt__line">{JOB_WORDS.watch}</p>}
          </div>
          <div className="ag-sheet-floor"><button className="zf-btn" onClick={() => setFunded(null)} data-testid="az-fund-done">Done</button></div>
        </Sheet>
      )}

      {sheet?.kind === "job" && <JobSheet sheet={sheet} running={jobOf(sheet.terms.kind)} agentOn={on || !pocketHere} sample={agent?.sample === true} pocketUsd={sheetPocketUsd} busy={busy} onStart={(t) => void once(startJob)(t)} onStop={onceStop(stopJob)} oldPocket={() => bridge.call<{ oldPocket?: true }>("account.agent.pocket").then((r) => "ok" in r && r.ok.oldPocket === true)} onEmpty={() => bridge.call<{ status?: string; declined?: true }>("account.agent.pocketEmpty").then((r) => ("problem" in r ? r.problem.more ?? r.problem.whatHappened : "declined" in r.ok ? null : r.ok.status === "done" ? "It's in your SOL wallet." : "Sent. Check Activity."))} onPocket={pocketHere ? () => setSheet({ kind: "pocket" }) : undefined} onClose={() => setSheet(null)} />}

      {sheet?.kind === "pay" && (
        <Sheet title="Pay once" onClose={() => setSheet(null)}>
          <p className="ag-answer ag-big">{`Pay ${dollars(sheet.usd)} to ${sheet.to}`}</p>
          <div className="ag-rows">
            <div className="ag-row"><span className="t">{jobOf("pay-list") ? `From AgentZero's wallet. Only if ${sheet.to} is on your list.` : `${sheet.to} needs to be on your pay list first.`}</span></div>
            <div className="ag-row"><span className="t">{agent?.sample || AGENT_PRIVATE_ROUTE ? "Only the middle of the payment is hidden." : PRIVATE_OFF_LINE}</span></div>
            {payCheck?.warn && <div className="ag-row alert"><span className="t">{payCheck.warn}</span></div>}
            {payCheck?.cannot && <div className="ag-row alert"><span className="t">{payCheck.cannot}</span></div>}
          </div>
          <div className="ag-sheet-floor">{/* Row 15: never a dead Pay. Off: turn AgentZero on; no list: make one; only a running list's Pay waits on the check. */}
            {!on ? (
              <button className="zf-btn" disabled={busy} onClick={() => setSheet({ kind: "pocket" })}>{FUND_BUTTON}</button>
            ) : !jobOf("pay-list") ? (
              <button className="zf-btn" disabled={busy} onClick={(e) => void once(payOnce)(sheet.id, sheet.to, sheet.usd, e.nativeEvent)}>Make a pay list</button>
            ) : (
              <button className="zf-btn" data-agentzero-pay={sheet.id} disabled={busy || payCheck === null || !!payCheck.cannot} onClick={(e) => void once(payOnce)(sheet.id, sheet.to, sheet.usd, e.nativeEvent)}>{`Pay ${dollars(sheet.usd)}`}</button>
            )}</div>
        </Sheet>
      )}

      {sheet?.kind === "routine" && (
        <Sheet title="A routine" onClose={() => setSheet(null)}>
          <div className="ag-rows">
            {routineLines(sheet.terms).map((l) => (
              <div key={l} className="ag-row"><span className="t">{l}</span></div>
            ))}
            {sheet.said && <div className="ag-row alert"><span className="t">{sheet.said}</span></div>}
          </div>
          <div className="ag-sheet-floor">
            <button
              className="zf-btn"
              disabled={busy || routineDry(sheet.terms)?.canApprove === false}
              onClick={() => {
                setBusy(true);
                void engine.startRoutine(sheet.terms).then((r) => {
                  setBusy(false);
                  if (r.ok) setSheet(null);
                  else setSheet({ kind: "routine", terms: sheet.terms, said: r.line });
                });
              }}
            >
              Approve
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === "act" && (
        <Sheet title="AgentZero" onClose={() => setSheet(null)}>
          <p className="ag-answer ag-big">{actWords(sheet)}</p>
          {agent?.sample && <p className="zf-small">On the web demo this uses sample money.</p>}
          <p className="zf-small">Next: what AgentZero would do and the most it can cost, then your yes. Never your Safe.</p>
          <div className="ag-sheet-floor">
            <button className="zf-btn" disabled={busy} onClick={() => void once(runAct)(sheet)}>Continue</button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === "said" && (
        <Sheet title="AgentZero" onClose={() => setSheet(null)}>
          {sheet.words && <p className="zf-small ag-said">{`You said: “${sheet.words}”`}</p>}
          {sheet.line.split("\n").map((l, i) => <p key={i} className="ag-answer">{l}</p>)}
        </Sheet>
      )}

      {sheet?.kind === "cannot" && (
        <Sheet title="AgentZero" onClose={() => setSheet(null)}>
          {/* test: the typed words, then the answer to THEM (cannotFor), never a bare list of jobs */}
          {sheet.words && <p className="zf-small ag-said">{`You said: “${sheet.words}”`}</p>}
          <p className="ag-answer">{sheet.line === CANNOT_LINE ? cannotJobLine(jobsLine(agent?.sample === true, !noPocket)) : sheet.line}</p>
          <div className="ag-rows">
            {offeredJobs(agent?.sample === true, !noPocket).map((k) => (
              <button key={k} className="ag-row" onClick={() => setSheet({ kind: "job", terms: defaultTerms(k, on ? pocketUsd : choice) })}><span className="t">{jobTitle(k)}</span><span className="v">›</span></button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet?.kind === "computer" && (
        <ComputerSheet
          said={sheet.said}
          busy={busy}
          onPair={async (offer) => {
            setBusy(true);
            const r = await bridge.call<{ status: "paired" | "declined"; words: string[] }>("account.agent.pairComputer", { offer });
            setBusy(false);
            if ("problem" in r) return void setSheet({ kind: "computer", said: r.problem.more && r.problem.code === "security.request.not-allowed" ? String(r.problem.more) : r.problem.whatHappened });
            if (r.ok.status !== "paired") return void setSheet({ kind: "computer", said: "Not paired. Nothing left this phone." });
            const at = new Date().toISOString();
            setComputerAt(at);
            void bridge.call("device.store.set", { key: COMPUTER_KEY, value: JSON.stringify({ atIso: at }) });
            setSheet({ kind: "computer", said: "Paired. Your computer finishes by itself in a few seconds." });
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === "key" && (
        <KeySheet
          has={hasOwnKey}
          onSave={async (k) => {
            await bridge.call("device.secret.set", { key: SECRETS.ownKey, value: k });
            setHasOwnKey(true);
            setSheet(null);
          }}
          onRemove={async () => {
            await bridge.call("device.secret.set", { key: SECRETS.ownKey, value: null });
            setHasOwnKey(false);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === "stop" && (
        <Sheet title="Stop AgentZero" onClose={() => setSheet(null)}>
          <div className="ag-rows">
            <div className="ag-row"><span className="t">AgentZero's key comes off your account now.</span></div>
            <div className="ag-row"><span className="t">Every job stops. Nothing more moves.</span></div>
            {agent?.sample && (agent.heldUsd ?? 0) > 0 && <div className="ag-row"><span className="t">{STOP_BACK_LINE(agent.heldUsd ?? 0)}</span></div>}
            <div className="ag-row"><span className="t">Your receipts stay here.</span></div>
          </div>
          <div className="ag-sheet-floor"><button className="zf-btn" disabled={stopBusy} onClick={() => void onceStop(stopAll)()}>Approve</button></div>
        </Sheet>
      )}
    </Frame>
  );
}

/** One job's sheet: what it does, its limit, Start (or Approve when it turns AgentZero on), and Stop when it runs. */
function JobSheet({ sheet, running, agentOn, sample, pocketUsd, busy, onStart, onStop, oldPocket, onEmpty, onPocket, onClose }: { sheet: Extract<SheetState, { kind: "job" }>; running: Job | undefined; agentOn: boolean; sample: boolean; pocketUsd: number; busy: boolean; onStart: (t: JobTerms) => void; onStop: (j: Job) => Promise<void> | void; oldPocket: () => Promise<boolean>; onEmpty: () => Promise<string | null>; onPocket?: () => void; onClose: () => void }) {
  // D117: a pocket made before the SOL row took its place: one row to move it there (the core's sheet asks first).
  const [hasOld, setHasOld] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [terms, setTerms] = useState<JobTerms>(sheet.terms);
  useEffect(() => setTerms(sheet.terms), [sheet.terms]);
  // the pay list's field as typed (a comma stays while the next name is typed); the list is parseList's, each name once
  const [listText, setListText] = useState(sheet.terms.kind === "pay-list" ? sheet.terms.people.join(", ") : "");
  useEffect(() => setListText(sheet.terms.kind === "pay-list" ? sheet.terms.people.join(", ") : ""), [sheet.terms]);
  const s = startSheet(terms, { agentOn, pocketUsd, sample });
  const problem = termsProblem(terms, pocketUsd);
  const fix = pocketFix(terms, pocketUsd);
  // with nothing to spend there's no "Make it" to offer: the raise row alone is the way on, never Close alone (UX hunt 078)
  const over = problem === overPocketLine(pocketUsd);
  const isRunning = running && running.id === (sheet.terms as Partial<Job>).id;
  useEffect(() => {
    if (sheet.terms.kind === "copy" && !sample) void oldPocket().then(setHasOld, () => undefined);
    // once per opened sheet: oldPocket is a new function every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.terms.kind, sample]);
  return (
    <Sheet title={s.title} onClose={onClose}>
      {/* a scroll box and a floor, as Send: the card ends above the button whatever it holds */}
      <div className="ag-sheet-column">
      <div className="ag-sheet-scroll">
      {sheet.said && <p className="zf-small ag-said">{`You said: “${sheet.said.words}”${sheet.said.by === "claude" ? " · read by Claude" : ` · read on ${thisDevice()}`}`}</p>}
      {terms.kind === "copy" && !isRunning && (
        <LeaderField value={terms.leader} onChange={(leader) => setTerms({ ...terms, leader })} />
      )}
      {/* ST-C: the wallet's report card before it is copied (read-only, from Solana's own record) */}
      {terms.kind === "copy" && !isRunning && <LeaderCard wallet={terms.leader} sample={sample} />}
      {terms.kind === "pay-list" && !isRunning && (
        <label className="ag-field">
          <span className="zf-small">Your list</span>
          <input value={listText} placeholder="name.near, friend.near" autoComplete="off" spellCheck={false} onChange={(e) => (setListText(e.target.value), setTerms({ ...terms, people: parseList(e.target.value) }))} />
        </label>
      )}
      {/* the keep job's wallet (D128): SOL, the default and for now the only one (Home's move ask names no wallet yet) */}
      {terms.kind === "keep" && !isRunning && (
        <div className="ag-field">
          <span className="zf-small">Which wallet</span>
          <div className="ag-pick">
            {KEEP_WALLETS.map((w) => (
              <button key={w} className={`ag-chip${(terms.wallet ?? "sol") === w ? " on" : ""}`} aria-pressed={(terms.wallet ?? "sol") === w} onClick={() => setTerms({ ...terms, wallet: w })}>{KEEP_WALLET[w].replace(/^your /, "Your ")}</button>
            ))}
          </div>
        </div>
      )}
      {s.lines[0]?.endsWith(":") && <div className="zf-label ag-section">{s.lines[0].slice(0, -1)}</div>}
      <div className="ag-rows">
        {s.lines.slice(s.lines[0]?.endsWith(":") ? 1 : 0).map((l) => (
          <div className="ag-row" key={l}><span className="t">{l}</span></div>
        ))}
      </div>
      {!isRunning && problem && <p className="zf-small ag-under">{over && !onPocket ? OVER_DAY_LINE : problem}</p>}
      {/* the refusal's own fixes (3 Nov e2e walk, 131): lower the job to the wallet, or fund the wallet */}
      {!isRunning && (fix || over) && (
        <div className="ag-rows">
          {fix && <button className="ag-row" onClick={() => setTerms(fix)}><span className="t">{fitLine(pocketUsd)}</span><span className="v">›</span></button>}
          {onPocket && <button className="ag-row" onClick={onPocket}><span className="t">{ADD_BUTTON}</span><span className="v">›</span></button>}
        </div>
      )}
      {hasOld && terms.kind === "copy" && !sample && (
        <div className="ag-rows">
          <button className="ag-row" onClick={() => void onEmpty().then((line) => line && (setMoved(line), setHasOld(false)))}><span className="t">Move AgentZero's pocket to your SOL wallet</span><span className="v">›</span></button>
        </div>
      )}
      {moved && <p className="zf-small ag-under">{moved}</p>}
      {/* test: every job says its rough cost before it runs, at the model's own price (fund-words.ts) */}
      {!isRunning && <p className="zf-small ag-under ag-cost">{jobCostLine()}</p>}
      </div>
      <div className="ag-sheet-floor">
        {isRunning && running ? (
          <button className="zf-btn" onClick={() => void onStop(running)}>Stop this job</button>
        ) : (
          <button className="zf-btn" disabled={busy || !!problem || s.button === "Not yet"} onClick={() => onStart(terms)}>{s.button}</button>
        )}
      </div>
      </div>
    </Sheet>
  );
}

/** Your own Claude key: kept in this phone's keychain, sent to Anthropic only through the call you start (D82). */
/** "Use AgentZero on a computer": paste the computer's code; the core's own sheet shows the check code before anything leaves. */
function ComputerSheet({ said, busy, onPair, onClose }: { said?: string; busy: boolean; onPair: (offer: string) => void; onClose: () => void }) {
  const [code, setCode] = useState("");
  return (
    <Sheet title="Use AgentZero on a computer" onClose={onClose}>
      <div className="ag-rows">
        <div className="ag-row"><span className="t">On your computer, run AgentZero and copy its code. Paste it here.</span></div>
        <div className="ag-row"><span className="t">Next, check that the 6 words on your computer match the ones on this phone.</span></div>
        <div className="ag-row"><span className="t">The computer can spend from AgentZero's wallet, like AgentZero here. Your Safe's key stays here.</span></div>
        <div className="ag-row"><span className="t">Stop AgentZero here any time. It stops on the computer too.</span></div>
        {said && <div className="ag-row alert"><span className="t">{said}</span></div>}
      </div>
      <textarea className="ag-paste" aria-label="The computer's code" rows={3} value={code} placeholder="zf-pair:2:…" onChange={(e) => setCode(e.target.value)} />
      <div className="ag-sheet-floor"><button className="zf-btn" disabled={busy || !code.trim().startsWith("zf-pair:")} onClick={() => onPair(code.trim())}>Continue</button></div>
    </Sheet>
  );
}

function KeySheet({ has, onSave, onRemove, onClose }: { has: boolean; onSave: (k: string) => Promise<void>; onRemove: () => Promise<void>; onClose: () => void }) {
  const [k, setK] = useState("");
  const ok = CLAUDE_KEY.test(k.trim());
  return (
    <Sheet title="Your Claude key" onClose={onClose}>
      <div className="ag-rows">
        <div className="ag-row"><span className="t">{PHONE ? "It stays in this phone's keychain." : "It stays on this device, encrypted, in this browser."}</span></div>
        <div className="ag-row"><span className="t">{`${ThisDevice()} sends it straight to Anthropic when you give AgentZero a job. It never goes to ZeroFee.`}</span></div>
        <div className="ag-row"><span className="t">Anthropic bills you for what Claude reads.</span></div>
      </div>
      {!has && (
        <label className="ag-field">
          <span className="zf-small">Your key from Anthropic</span>
          <input type="password" value={k} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} onChange={(e) => setK(e.target.value)} />
        </label>
      )}
      {!has && k.trim() !== "" && !ok && <p className="zf-small ag-under">That isn't a Claude key. It starts with sk-ant-.</p>}
      <div className="ag-sheet-floor">
        {has ? <button className="zf-btn" onClick={() => void onRemove()}>Remove my key</button> : <button className="zf-btn" disabled={!ok} onClick={() => void onSave(k.trim())}>Save my key</button>}
      </div>
    </Sheet>
  );
}

/** The old tab keeps its AppFrame; the sheet and Settings sit in the shell's own frames. */
function Frame({ part, children }: { part: AgentZeroPart; children: ReactNode }) {
  return part === "all" ? <AppFrame name="AgentZero" tray={NO_TRAY} tab="jobs" onTab={() => undefined}>{children}</AppFrame> : <>{children}</>;
}

/** The chat's card for a ChatSheet (D122): the core's own sheet for a job, a payment, a job to stop, or an act; the
 *  person's tap does the rest. `onDone` when the sheet is closed. A browse sheet is the browser card's, not this. */
export function ChatSheetCard({ bridge, sheet, onDone }: { bridge: Bridge; sheet: ChatSheet; onDone?: () => void }) {
  if (sheet.kind === "browse") return null;
  if (sheet.kind === "memory") return <RememberCard bridge={bridge} kind={sheet.memory} text={sheet.text} />;
  return <AgentZeroScreens bridge={bridge} part="sheet" open={sheet} {...(onDone ? { onClose: onDone } : {})} />;
}

/** The swipe-up sheet's AgentZero (D118/D120): the words box and what a reading leads to. `bridge`: forApps(…, "agent"). */
export function AgentZeroAsk({ bridge, onClose }: { bridge: Bridge; onClose?: () => void }) {
  return <AgentZeroScreens bridge={bridge} part="ask" {...(onClose ? { onClose } : {})} />;
}

/** Settings → AgentZero: jobs, its wallet and limits, Ask me first, receipts with Why, the computer door, the Claude
 *  key, Stop AgentZero. `bridge`: forApps(…, "agent"). */
export function AgentZeroSettings({ bridge }: { bridge: Bridge }) {
  return (
    <>
      <AgentZeroScreens bridge={bridge} part="settings" below={<MemoryList bridge={bridge} />} />
    </>
  );
}

/** What the "Remember this?" card says once the person answered. */
export const REMEMBER_LINE = { kept: "Kept. You can delete it in Jobs and limits.", no: "Not kept. AgentZero won't remember it." } as const;

/** "Remember this?" (A-11): AgentZero only proposes; the person's Keep stores the line. */
function RememberCard({ bridge, kind, text }: { bridge: Bridge; kind: MemoryLine["kind"]; text: string }) {
  const [said, setSaid] = useState<string | null>(null);
  // the card keeps its own answer in the chat (real-Claude walk, 3 Nov: closing it on Keep left "Keep it?" as the last
  // word, after it was kept), so it never closes itself
  const keep = async () => {
    const r = await memoryStore(bridge).keep(kind, text);
    setSaid(r.ok ? REMEMBER_LINE.kept : r.line);
  };
  return (
    <div className="ag-rows">
      <div className="ag-row"><span><span className="t">Remember this?</span><span className="d">{`${MEMORY_KIND_WORDS[kind]}: ${text}`}</span></span></div>
      {said ? <p className="zf-small">{said}</p> : (
        <div className="ag-sheet-floor">
          <button className="zf-btn" onClick={() => void keep()}>Keep</button>
          <button className="zf-link" onClick={() => setSaid(REMEMBER_LINE.no)}>No</button>
        </div>
      )}
    </div>
  );
}

/** Settings → AgentZero → What AgentZero remembers (A-11): every line, each with Delete. */
function MemoryList({ bridge }: { bridge: Bridge }) {
  const store = useMemo(() => memoryStore(bridge), [bridge]);
  const [lines, setLines] = useState<MemoryLine[] | null>(null);
  useEffect(() => {
    void store.list().then(setLines, () => setLines([]));
  }, [store]);
  return (
    <>
      <div className="zf-label ag-section">What AgentZero remembers</div>
      <div className="ag-rows">
        {lines === null ? null : lines.length === 0 ? (
          <div className="ag-row"><span className="t">Nothing yet. AgentZero asks before it remembers anything.</span></div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="ag-row">
              <span><span className="t">{l.text}</span><span className="d">{MEMORY_KIND_WORDS[l.kind]}</span></span>
              <button className="zf-link" aria-label={`Delete ${l.text}`} onClick={() => void store.remove(l.id).then(() => setLines((x) => (x ?? []).filter((y) => y.id !== l.id)))}>Delete</button>
            </div>
          ))
        )}
      </div>
      <p className="zf-small ag-under">Memory helps AgentZero answer. It never tells it to pay.</p>
    </>
  );
}

function AgentRoot() {
  return <AgentZeroScreens />;
}

export const agentApp: AppModule = { id: "agent", name: "AgentZero", line: "Its own wallet, one job, a receipt for each move.", Root: AgentRoot };
export { OPEN_LINE };
