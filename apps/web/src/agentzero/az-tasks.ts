// AgentZero's work in the app's ONE Activity centre (D144, product decision, 3 Nov: "Right now I can't find where active jobs go for
// anything at all"): every money ask from the chat, AgentZero's running jobs and routines, and its wallet's fills, empties
// and credit buys, each a task with its real steps. The shell keeps the tasks (useShell().tasks, shell-api tasks.ts, the
// shell's branch shell/activity); until that is on main this is a narrow local copy of its shape, called only
// when the shell has it, so nothing breaks today. Every step comes from what AgentZero itself saw (the sheet's own end,
// Activity's own read): a read that failed never makes a step, and no title carries an address or a name. Pure: node
// tests it (az-tasks.test.ts).
import type { HomeAsk, HomeCoin, HomePlace } from "@zerofee/agent/chat/home-ask";
import type { Job } from "@zerofee/agent/zero/jobs";
import type { Receipt } from "@zerofee/agent/zero/receipts";
import type { Routine } from "@zerofee/agent/zero/routines";

/** The shell's task API (shell-api tasks.ts, D144): an app publishes, updates and ends its own tasks; the shell stamps
 *  the app and the times, and each call answers false when it refused. */
import type { TaskInput, TaskStep as ShellStep, TaskState as ShellState, Tasks as ShellTasks } from "@zerofee/shell-api/tasks.ts";
export type TaskStep = ShellStep;
export type TaskState = ShellState;
export type StepState = TaskStep["state"];
export type Task = TaskInput;
/** The shell's tasks, and the centre itself when the shell offers it (tasks.open, next). */
export type Tasks = ShellTasks & { open?: (filter?: { app?: string }) => void };
/** The shell's tasks, if it has them (never an error when it doesn't). */
export const tasksOf = (shell: { tasks?: ShellTasks | undefined } | null | undefined): Tasks | null => {
  const t = shell?.tasks as Partial<Tasks> | undefined;
  return t && typeof t.publish === "function" && typeof t.update === "function" && typeof t.end === "function" ? (t as Tasks) : null;
};

/** Where a tap in the centre takes the person: AgentZero's own tab routes (the shell opens AgentZero with it, as
 *  openApp's): the chat ("ask", as Siri's Ask AgentZero), or Jobs and limits ("jobs"). */
export const CHAT_ROUTE = "ask";
export const JOBS_ROUTE = "jobs";

const COIN: Record<HomeCoin, string> = { SOL: "SOL", ETH: "ETH (RH)", NEAR: "NEAR", USDC: "USDC", BNB: "BNB" };
const PLACE: Record<HomePlace, string> = { safe: "your Safe", sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
const CHAIN: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", near: "NEAR", bsc: "BNB Chain" };
const usd = (x: string | number | undefined) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : ""; };
/** A ticker as a word only when it looks like one (a coin's name could be anything a stranger chose). */
const ticker = (s: string | undefined) => (s && /^[A-Za-z0-9.$_-]{1,12}$/.test(s) ? s : "a coin");

/** A money ask's title: what and how much, never who it goes to (no address, no name). */
export function moneyTitle(a: HomeAsk): string {
  switch (a.kind) {
    case "send": return `Send ${usd(a.usd)}${a.coin ? ` in ${COIN[a.coin]}` : ""} on ${CHAIN[a.chain] ?? "a chain"}`.replace(/\s+/g, " ").trim();
    case "swap": return `Swap ${usd(a.usd)} of ${COIN[a.from]} to ${COIN[a.to]}`.replace(/\s+/g, " ");
    case "move": return `Move ${usd(a.usd) || "everything"} from ${PLACE[a.from]} to ${PLACE[a.to]}`;
    case "receive": return a.coin ? `Add ${COIN[a.coin]}` : `Add to ${PLACE[a.wallet ?? "safe"]}`;
    case "request": return `Request ${usd(a.usd)}`.trim();
    case "trade": return `${a.side === "buy" ? "Buy" : "Sell"} ${a.usd ? `${usd(a.usd)} of ` : a.pct ? `${a.pct}% of ` : ""}${ticker(a.symbol)}`;
  }
}

/** The wallet a Move or a Swap goes on to after the NEAR wallet (its second step), or null. */
export function hopTo(a: HomeAsk): "sol" | "hood" | null {
  if (a.kind === "move") return a.to === "sol" || a.to === "hood" ? a.to : null;
  if (a.kind === "swap") return a.to === "SOL" ? "sol" : a.to === "ETH" ? "hood" : null;
  return null;
}

/**
 * Where one money ask stands, from what AgentZero saw:
 * - "opened": Home's sheet is open; "closed": closed with nothing moved; "approved": it went (the sheet's own end);
 * - "moving" / "step-one" (a Move's or Swap's first step landed in the NEAR wallet, the step on not yet read) /
 *   "landed" / "came-back" / "stopped" (a problem) / "held";
 * - "unconfirmed": it went, and nothing confirmed it landed in 30 minutes of following: stopped, never "done"
 *   (review, 3 Nov: never "done" or "landed" unless Activity or the chain confirms it);
 * - "added": an Add or a Request is open for money (its address is ready); "refused": the app wouldn't open it;
 * - "unread": Activity couldn't be read the whole time it was followed; "lost": after a restart, the ask had no move id
 *   to follow (both stop following, and no step is called done that wasn't seen).
 */
export type MoneyPhase = "opened" | "closed" | "approved" | "moving" | "step-one" | "on-to-wallet" | "landed" | "came-back" | "stopped" | "held" | "unconfirmed" | "added" | "refused" | "handed-over" | "unread" | "lost";
const END: Partial<Record<MoneyPhase, Exclude<TaskState, "pending">>> = { closed: "stopped", landed: "done", "came-back": "failed", stopped: "failed", held: "stopped", unconfirmed: "stopped", added: "done", refused: "failed", "handed-over": "stopped", unread: "stopped", lost: "stopped" };
export const isEnd = (p: MoneyPhase) => p in END;

/** The steps for one ask at one phase: the same labels throughout, each step's state from what was seen. */
export function moneySteps(a: HomeAsk, p: MoneyPhase, openLabel?: string): TaskStep[] {
  const open = openLabel ?? (a.kind === "send" ? "Opened Send" : a.kind === "swap" ? "Opened Swap" : a.kind === "move" ? "Opened Move" : a.kind === "trade" ? "Opened Trade" : "Opened Add");
  if (a.kind === "receive" || a.kind === "request") {
    return [{ label: open, state: p === "opened" ? "doing" : p === "refused" ? "failed" : "done" }, { label: "Address ready for the money", state: p === "added" ? "done" : p === "opened" ? "waiting" : "waiting" }];
  }
  const hop = hopTo(a);
  const labels = [open, "Approved", "On its way", ...(hop ? ["Step one landed, in your NEAR wallet", `On to ${PLACE[hop]}`] : []), "Landed"];
  // how far it got: the index of the step being done now (or the last one done), and whether that one failed
  const at: Record<MoneyPhase, number> = { opened: 0, closed: 1, refused: 0, approved: 2, moving: 2, "step-one": 4, "on-to-wallet": 4, landed: labels.length, "came-back": 2, stopped: 2, held: 2, unconfirmed: 2, added: 0, "handed-over": 1, unread: 2, lost: 2 };
  const k = Math.min(at[p], labels.length);
  const failed = p === "came-back" || p === "stopped" || p === "refused";
  const ended = isEnd(p);
  return labels.map((label, i) => ({
    label,
    // a closed sheet, a hold or an unconfirmed move leave their step waiting: nothing is called done that wasn't seen
    // step one landed and the step on not read: that step waits (never shown as being done)
    state: i < k ? "done" : i === k ? (failed ? "failed" : ended || p === "step-one" ? "waiting" : "doing") : "waiting",
  }));
}

/** Each phase's line under the task, plain. */
export function phaseDetail(a: HomeAsk, p: MoneyPhase, line?: string): string | undefined {
  const hop = hopTo(a);
  switch (p) {
    case "closed": return line ?? "Closed. Nothing moved.";
    case "landed": return line ?? "Landed. It's in your Activity.";
    case "came-back": return "It came back to you, so nothing was lost.";
    case "stopped": return line ?? "It stopped. The move didn't go through.";
    case "held": return "On hold for your safety. Nothing has moved yet.";
    case "unconfirmed": return "Couldn't confirm it landed. Check Activity.";
    case "step-one": return hop ? `Step one landed, in your NEAR wallet. AgentZero is following the step on to ${PLACE[hop]}.` : undefined;
    case "added": return line ?? "Money sent to its address shows in your Activity.";
    case "refused": return line;
    case "unread": return "AgentZero couldn't read your Activity to follow it. Activity shows it when it lands.";
    case "lost": return line ?? "AgentZero lost sight of it after a restart. Activity shows it when it lands.";
    case "handed-over": return "Opened Trade. Finish it there.";
    default: return undefined;
  }
}

/** Where the money is now, only where AgentZero saw it: step one landed in the NEAR wallet; landed where it was going. */
export function whereNow(a: HomeAsk, p: MoneyPhase): string | undefined {
  if (p === "step-one" || p === "on-to-wallet") return "In your NEAR wallet";
  if (p !== "landed") return undefined;
  if (a.kind === "move") return `In ${PLACE[a.to]}`;
  const hop = hopTo(a);
  return hop ? `In ${PLACE[hop]}` : undefined;
}

let seq = 0;
/** A refusal is false; a shell that answers nothing (void) took it. */
const took = (r: boolean) => r !== false;

/** A money ask still in flight, kept on this phone so a restart re-attaches to its task instead of publishing again. */
export interface KeptAsk { id: string; ask: HomeAsk; phase: MoneyPhase; movementId?: string; at: number; /** when it was asked (its 30 minutes count from here) */ since?: number; /** with no move id: the moves there were before the sheet opened, so a restart follows the new ones */ before?: string[]; /** a pay sheet's task (followed by AgentZero's receipts); none: a money ask from before one task per move */ sheet?: "pay" }
export interface AskKeep { all(): KeptAsk[]; put(k: KeptAsk): void; drop(id: string): void }
/** The phone's own store for it (localStorage, as the shell keeps its tasks); nothing leaves the phone. */
export const KEEP_KEY = "agentzero.tasks.asks.v1";
/** Audit L18: what is kept at rest is the ask's kind only, never who (`to`), a note or the dollars: a restart
 *  re-attaches by the task's id and its receipt or move id, and its steps need only the kind. */
const atRest = (k: KeptAsk) => ({ id: k.id, kind: k.ask.kind, phase: k.phase, at: k.at, ...(k.since !== undefined ? { since: k.since } : {}), ...(k.movementId ? { movementId: k.movementId } : {}), ...(k.before ? { before: k.before } : {}), ...(k.sheet ? { sheet: k.sheet } : {}) });
/** The ask a kept task is rebuilt with: its kind, nothing else (no payee, no amount). */
const kindOnly = (_kind: unknown): HomeAsk => ({ kind: "send", to: "", chain: "near", usd: "" });
export function localKeep(store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): AskKeep {
  const read = (): KeptAsk[] => {
    try {
      const v = JSON.parse(store?.getItem(KEEP_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.phase === "string").map((x) => ({ ...x, ask: kindOnly(x.kind) })) : [];
    } catch { return []; }
  };
  const write = (l: KeptAsk[]) => { try { store?.setItem(KEEP_KEY, JSON.stringify(l.slice(-20).map(atRest))); } catch { /* full or off: the task still shows */ } };
  return { all: read, put: (k) => write([...read().filter((x) => x.id !== k.id), k]), drop: (id) => write(read().filter((x) => x.id !== id)) };
}

/**
 * One money ask's task, from the sheet opening to its end: published once, updated only when a step changes, ended once.
 * `tasks` null (no shell centre yet), or a refused publish: every call does nothing. `again`: a kept ask after a restart,
 * re-attached to its own task id (updated, never published twice).
 */
export function moneyTask(tasks: Tasks | null, a: HomeAsk, o: { now?: () => number; keep?: AskKeep; again?: KeptAsk; title?: string; openLabel?: string; sheet?: "pay" } = {}) {
  const sheet = o.sheet ?? o.again?.sheet;
  const now = o.now ?? Date.now;
  const id = o.again?.id ?? `agentzero:money:${now().toString(36)}:${(seq++).toString(36)}`;
  let phase: MoneyPhase | null = o.again?.phase ?? null;
  let shown: TaskStep[] | null = o.again ? moneySteps(a, o.again.phase, o.openLabel) : null;
  const title = o.title ?? moneyTitle(a);
  let last = shown ? JSON.stringify(shown.map((x) => x.state)) : "";
  let ended = false;
  let movementId = o.again?.movementId;
  let before = o.again?.before;
  const since = o.again?.since ?? o.again?.at ?? now();
  const stamp = (steps: TaskStep[], prev: TaskStep[] | null) => steps.map((x, i) => (x.state !== "waiting" ? { ...x, at: prev?.[i]?.state === x.state && prev[i]!.at ? prev[i]!.at : now() } : x));
  return {
    id,
    /** The move the sheet handed back, kept for a restart. */
    moved(mid: string | undefined, known?: ReadonlySet<string>): void {
      movementId = mid;
      if (!mid && known) before = [...known].slice(0, 100);
      if (phase && !ended) o.keep?.put({ id, ask: a, phase, ...(mid ? { movementId: mid } : before ? { before } : {}), at: now(), since, ...(sheet ? { sheet } : {}) });
    },
    /** Move to a phase (a repeat of the same steps changes nothing; nothing after the end). */
    to(p: MoneyPhase, line?: string): void {
      if (!tasks || ended) return;
      const steps = stamp(moneySteps(a, p, o.openLabel), shown);
      const key = JSON.stringify(steps.map((x) => x.state));
      const detail = phaseDetail(a, p, line);
      const where = whereNow(a, p);
      if (phase === null) {
        // refused (or no room): this ask goes on in the chat's card alone
        if (!took(tasks.publish({ id, title, steps, open: { route: CHAT_ROUTE }, ...(where ? { where } : {}), ...(detail ? { detail } : {}) }))) { ended = true; return; }
      } else if (key !== last && !took(tasks.update(id, { steps, ...(where ? { where } : {}), ...(detail ? { detail } : {}) }))) {
        // re-attached after a restart, and the shell no longer has it (its store was cleared): published again, once
        if (!o.again || !took(tasks.publish({ id, title, steps, open: { route: CHAT_ROUTE }, ...(where ? { where } : {}), ...(detail ? { detail } : {}) }))) { ended = true; o.keep?.drop(id); return; }
      }
      phase = p;
      last = key;
      shown = steps;
      const end = END[p];
      if (end) {
        ended = true;
        o.keep?.drop(id);
        tasks.end(id, end, detail);
      } else o.keep?.put({ id, ask: a, phase: p, ...(movementId ? { movementId } : before ? { before } : {}), at: now(), since, ...(sheet ? { sheet } : {}) });
    },
    get ended() { return ended; },
    /** When it was asked. */
    since,
  };
}

/** The tasks for AgentZero's running jobs and routines, from its engine: one per job or routine that is on. */
export function engineTasks(o: { jobs: readonly Job[]; routines: readonly Routine[]; receipts: readonly Receipt[] }, words: { job: (j: Job) => string; jobLine: (j: Job) => string; routine: (r: Routine) => string; routineLine: (r: Routine) => string }): Task[] {
  // a task's steps keep their own times; the shell stamps when the task began
  const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
  return [
    ...o.jobs.filter((j) => j.on).map((j): Task => {
      const last = o.receipts.filter((r) => r.jobId === j.id).sort((x, y) => ms(y.atIso) - ms(x.atIso))[0];
      return {
        id: `agentzero:job:${j.id}`, title: words.job(j), open: { route: JOBS_ROUTE }, detail: words.jobLine(j),
        steps: [{ label: "Started, on your Approve", state: "done", at: ms(j.startedAtIso) }, ...(last ? [{ label: last.state === "refused" ? "Last time: AgentZero said no" : last.state === "note" ? "Last time: nothing moved" : "Last time: done", state: last.state === "refused" ? ("failed" as const) : ("done" as const), at: ms(last.atIso) }] : []), { label: "Running", state: "doing" }],
      };
    }),
    ...o.routines.filter((r) => r.on).map((r): Task => ({
      // a pay reminder's line names who (doWords): the centre's copy says only that it reminds (kept on the phone, Audit L18)
      id: `agentzero:routine:${r.id}`, title: words.routine(r), open: { route: JOBS_ROUTE }, detail: r.do.act === "pay" ? "AgentZero reminds you to pay. You pay it with a tap." : words.routineLine(r),
      steps: [{ label: "Started, on your tap", state: "done", at: ms(r.startedAtIso) }, ...(r.lastPeriod ? [{ label: `Last ran: ${r.lastPeriod}`, state: "done" as const }] : []), { label: "Waiting for its time", state: "doing" }],
    })),
  ];
}

/**
 * Keeps the centre in step with the engine: a new job or routine is published, a changed one updated, one that stopped
 * (or is gone) ended "stopped", each once. `kept`: what was published (id → its last shape), kept on this phone so a
 * restart updates the same task, never publishes it again. Null: the engine hasn't loaded, so nothing is ended for it.
 */
export function syncEngine(tasks: Tasks | null, now: readonly Task[] | null, kept: Map<string, string>): void {
  if (!tasks || !now) return;
  const ids = new Set(now.map((t) => t.id));
  for (const t of now) {
    const shape = fingerprint(JSON.stringify([t.title, t.steps, t.detail]));
    if (!kept.has(t.id)) { if (took(tasks.publish(t))) kept.set(t.id, shape); continue; }
    if (kept.get(t.id) !== shape) tasks.update(t.id, { title: t.title, steps: t.steps, ...(t.detail ? { detail: t.detail } : {}) });
    kept.set(t.id, shape);
  }
  for (const id of [...kept.keys()]) if (!ids.has(id)) { tasks.end(id, "stopped", "Stopped. AgentZero won't do it from here."); kept.delete(id); }
}
/** A short fingerprint of a task's shape (FNV-1a): what is kept at rest to tell a change, never its words (Audit L18). */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
/** The engine's published tasks, kept on this phone (id → fingerprint). */
export const ENGINE_KEY = "agentzero.tasks.engine.v1";
export function keptEngine(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): Map<string, string> {
  try { const v = JSON.parse(store?.getItem(ENGINE_KEY) ?? "{}"); return new Map(Object.entries(v && typeof v === "object" ? v : {}).filter((e): e is [string, string] => typeof e[1] === "string")); } catch { return new Map(); }
}
export function saveEngine(kept: Map<string, string>, store: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try { store?.setItem(ENGINE_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* the centre still has them */ }
}

/** One step of AgentZero's own wallet (fill, empty, a credit buy), as a task: published and ended at once by its outcome. */
/** Answers its row's id (a fill's job hands its starting row to it), or null when none was published. */
export function walletTask(tasks: Tasks | null, kind: "fill" | "empty" | "credit", usdAmount: number | null, outcome: { ok: true } | { declined: true } | { line: string }, now: () => number = Date.now): string | null {
  if (!tasks) return null;
  const title = kind === "fill" ? `Add ${usd(usdAmount ?? 0) || "money"} to AgentZero's wallet` : kind === "empty" ? "Move AgentZero's wallet to your Safe" : `Buy ${usd(usdAmount ?? 1) || "$1.00"} of thinking for AgentZero`;
  const id = `agentzero:wallet:${kind}:${now().toString(36)}:${(seq++).toString(36)}`;
  const t = now();
  const steps: TaskStep[] = kind === "credit"
    ? [{ label: "Paid from AgentZero's wallet", state: "ok" in outcome ? "done" : "failed", at: t }]
    : [{ label: "Asked on your Face ID", state: "done", at: t }, { label: "Approved", state: "ok" in outcome ? "done" : "declined" in outcome ? "waiting" : "failed", ...("ok" in outcome ? { at: t } : {}) }];
  if (!took(tasks.publish({ id, title, steps, open: { route: CHAT_ROUTE } }))) return null;
  tasks.end(id, "ok" in outcome ? "done" : "declined" in outcome ? "stopped" : "failed", "ok" in outcome ? undefined : "declined" in outcome ? "You said no. Nothing moved." : outcome.line);
  return id;
}

/** D37 (QA 4 Nov: Activity showed no AgentZero rows): each paid reply is one receipt row in the app's Activity centre,
 *  published and ended at once: what AgentZero paid for it, from its own wallet (`title`: wallet-words receiptTitle). */
export const RECEIPT_WHERE = "Paid from AgentZero's wallet";
/** A receipt's dollars, AgentZero's one rule (wallet-words money): "$0.045" under a dollar, "$1.27" from one. */
const receiptUsd = (micros: number): string => (micros >= 1e6 ? `$${(micros / 1e6).toFixed(2)}` : `$${(Math.round(micros / 1e3) / 1e3).toFixed(3)}`);
/** The rows made this session for each message (by its bubble's id): its row's id, what its payments paid, their transactions. */
const turnRows = new Map<string, { id: string; micros: number; proof: { chain: string; hash: string }[]; at: number }>();
/**
 * One paid reply's receipt row. `turn` (the message being answered): a message of several calls is paid in parts (each
 * call's cost before the next goes, D37); its payments are ONE row, its dollars their sum, each transaction under it
 * (QA 5 Nov: two rows, 0.4¢ and 0.3¢, for one reply). Without it, a row per payment, as before.
 */
export function replyReceipt(tasks: Tasks | null, micros: number, title: string, now: () => number = Date.now, tx?: string, turn?: { id: string; titleOf: (micros: number) => string }): void {
  if (!tasks || !(micros > 0)) return;
  const was = turn ? turnRows.get(turn.id) : undefined;
  const t = was?.at ?? now();
  const id = was?.id ?? `agentzero:reply:${now().toString(36)}:${(seq++).toString(36)}`;
  const sum = (was?.micros ?? 0) + micros;
  const txs = [...(was?.proof ?? []), ...(tx ? [{ chain: "near", hash: tx }] : [])];
  if (turn) turnRows.set(turn.id, { id, micros: sum, proof: txs, at: t });
  // its receipt (QA 4 Nov: a tap opened nothing): the dollars, where they came from, and the payments' NEAR transactions
  const proof = txs.length ? { proof: txs } : {};
  if (!took(tasks.publish({ id, title: was && turn ? turn.titleOf(sum) : title, usd: receiptUsd(sum), where: RECEIPT_WHERE, steps: [{ label: RECEIPT_WHERE, state: "done", at: t }], open: { route: CHAT_ROUTE }, startedAt: t, ...proof }))) return;
  tasks.end(id, "done");
}

/** The chat's older money sheets (the agent package's ChatSheetCard: a payment, or an act: send, swap, move, pay, trade), as a
 *  task: what and how much, never who (a payment's payee stays on its sheet). */
export type MoneySheet = { kind: "pay"; usd: number } | { kind: "act"; act: string; from: string; to: string | null; usd: number };
const SHEET_PLACE: Record<string, string> = { spending: "your NEAR wallet", near: "your NEAR wallet", sol: "your SOL wallet", hood: "your ETH (RH) wallet", bsc: "your BNB wallet", safe: "your Safe", agent: "AgentZero's wallet" };
export function sheetTitle(s: MoneySheet): string {
  if (s.kind === "pay") return `Pay ${usd(s.usd) || "someone"}`.trim();
  const act = /^(send|swap|move|pay|trade)$/.test(s.act) ? s.act[0]!.toUpperCase() + s.act.slice(1) : "Move";
  return `${act} ${usd(s.usd)}${SHEET_PLACE[s.from] ? ` from ${SHEET_PLACE[s.from]}` : ""}${s.to && SHEET_PLACE[s.to] ? ` to ${SHEET_PLACE[s.to]}` : ""}`.replace(/\s+/g, " ");
}
/** The ask a sheet's task is kept as (its steps: Opened the sheet → Approved → On its way → Landed). */
export const sheetAsk = (s: MoneySheet): HomeAsk => ({ kind: "send", to: "", chain: "near", usd: String(s.usd) });
export const SHEET_OPEN = "Opened the sheet";
/** How long after the sheet closed a move must show before "nothing moved" is said. */
export const SHEET_LOOK_MS = 120_000;

/** Never "done" unconfirmed: 30 minutes of following, then stopped. */
export const CONFIRM_MS = 30 * 60_000;

/**
 * One task per move (review, 3 Nov): a money ask that opens Home's or Trade's own sheet is that app's task, and an
 * act sheet's move is Spending's row, which Home's tracks publish. Only a pay sheet (AgentZero's its wallet, paid by the
 * core's agent door: no Activity row, no Home track) is AgentZero's own task, followed by AgentZero's own receipt.
 */
export const OWN_SHEETS: ReadonlySet<string> = new Set(["pay"]);

/** The receipt a pay sheet left: the newest payment receipt made after Review (a little early, for the clocks). */
export function payReceipt(receipts: readonly Receipt[], since: number): Receipt | null {
  const t = (iso: string) => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };
  return [...receipts].filter((r) => t(r.atIso) >= since - 5_000 && /\bpa(id|y)\b/i.test(r.title)).sort((a, b) => t(b.atIso) - t(a.atIso))[0] ?? null;
}
/** A pay sheet's phase from its receipt: paid (the core's own outcome) → landed; AgentZero said no → stopped; none two
 *  minutes after the sheet closed → closed, nothing paid; else still open. */
export function payPhase(r: Pick<Receipt, "state"> | null, o: { closedAt: number | null; now: number }): MoneyPhase {
  if (r?.state === "done") return "landed";
  if (r?.state === "refused") return "stopped";
  return o.closedAt !== null && o.now - o.closedAt > SHEET_LOOK_MS ? "closed" : "opened";
}
