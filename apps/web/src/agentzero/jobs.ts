// AgentZero's Jobs (product decision, 3 Nov: "if you send money or swap and you want to continue talking, where do you see the
// current jobs?"): what is happening now and what finished in the last day, from the core's own state only. The moves
// are Home's Activity's own reads (ledger.activity, spending.activity, merged as Activity merges them); AgentZero's jobs,
// routines and receipts are its engine's (zero/engine.ts). A read that failed is said, never a list short by it, and no
// status is ever made up here: each item's state is the record's own. Pure, so node tests it (jobs.test.ts).
import type { Movement } from "@zerofee/wallet/types.ts";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Job } from "@zerofee/agent/zero/jobs";
import type { Receipt } from "@zerofee/agent/zero/receipts";
import type { Routine } from "@zerofee/agent/zero/routines";
import { activityRows } from "@zerofee/wallet/app/activity-rows.ts";
import { MAIL_SEND_LIVE } from "./inbox-gate.ts";

/** A read: its rows, "unread" (it was asked and failed), or null (not answered yet). */
export type Read<T> = T[] | "unread" | null;
export interface JobsRead {
  ledger: Read<Movement>;
  spending: Read<SpendingActivity>;
  /** AgentZero's engine (jobs, routines, receipts); null until it has loaded. */
  agent: { jobs: Job[]; routines: Routine[]; receipts: Receipt[] } | null;
}

/** An item's state, the record's own: "on-its-way" and "waiting" are in flight. */
export type JobState = "on-its-way" | "waiting" | "done" | "came-back" | "problem" | "running";
export const STATE_WORDS: Record<JobState, string> = { "on-its-way": "On its way", waiting: "Waiting", done: "Done", "came-back": "Came back", problem: "Didn't go through", running: "Running" };

export type JobItem =
  | { key: string; kind: "move"; state: JobState; atIso: string; startedIso: string; by?: "agentzero"; ledger: Movement }
  | { key: string; kind: "move"; state: JobState; atIso: string; startedIso: string; by?: "agentzero"; spending: SpendingActivity }
  | { key: string; kind: "job"; state: "running"; atIso: string; startedIso: string; job: Job }
  | { key: string; kind: "routine"; state: "running"; atIso: string; startedIso: string; routine: Routine }
  | { key: string; kind: "receipt"; state: JobState; atIso: string; startedIso: string; receipt: Receipt };

export const DAY_MS = 24 * 3_600_000;
const LEDGER_STATE: Record<Movement["status"], JobState> = { moving: "on-its-way", waiting: "waiting", done: "done", refunded: "came-back", problem: "problem" };
const SPENDING_STATE: Record<SpendingActivity["status"], JobState> = { "on-its-way": "on-its-way", waiting: "waiting", "waiting-for-you": "waiting", done: "done", refunded: "came-back", refused: "problem", failed: "problem" };
export const inFlight = (s: JobState) => s === "on-its-way" || s === "waiting";
const t = (iso: string) => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };

/** The lists: now (in flight, then AgentZero's running jobs and routines), the last day's finished ones (newest first),
 *  the count of moves in flight (the top bar's "Now"), and which reads failed (said on the screen). */
export function jobsOf(r: JobsRead, nowMs: number): { now: JobItem[]; recent: JobItem[]; moving: number; unread: string[]; loading: boolean } {
  const ledger = Array.isArray(r.ledger) ? r.ledger.filter((m) => !!m && typeof m.id === "string" && typeof m.status === "string" && m.kind !== "account") : [];
  const spending = Array.isArray(r.spending) ? r.spending.filter((s) => !!s && typeof s.id === "string" && typeof s.status === "string" && typeof s.atIso === "string") : [];
  // one move, one row (Activity's own rule): Spending's row wins over the ledger's for the same Top up or Put away
  const merged = activityRows(ledger, spending);
  const moves: JobItem[] = [
    ...merged.ledger.filter((m) => m.amount).map((m): JobItem => ({ key: `ledger:${m.id}`, kind: "move", state: LEDGER_STATE[m.status] ?? "problem", atIso: m.updatedAtIso, startedIso: m.startedAtIso || m.updatedAtIso, ledger: m })),
    ...merged.spending.map((s): JobItem => ({ key: `spending:${s.id}`, kind: "move", state: SPENDING_STATE[s.status] ?? "problem", atIso: s.atIso, startedIso: s.atIso, ...(s.by === "agentzero" ? { by: "agentzero" as const } : {}), spending: s })),
  ];
  const agent = r.agent;
  const running: JobItem[] = agent ? [
    ...agent.jobs.filter((j) => j.on).map((j): JobItem => ({ key: `job:${j.id}`, kind: "job", state: "running", atIso: j.startedAtIso, startedIso: j.startedAtIso, job: j })),
    ...agent.routines.filter((x) => x.on).map((x): JobItem => ({ key: `routine:${x.id}`, kind: "routine", state: "running", atIso: x.startedAtIso, startedIso: x.startedAtIso, routine: x })),
  ] : [];
  const receipts: JobItem[] = agent ? agent.receipts.map((x): JobItem => ({ key: `receipt:${x.id}`, kind: "receipt", state: x.state === "refused" ? "problem" : "done", atIso: x.atIso, startedIso: x.atIso, receipt: x })) : [];
  const newest = (a: JobItem, b: JobItem) => t(b.atIso) - t(a.atIso);
  const flying = moves.filter((m) => inFlight(m.state)).sort(newest);
  const recent = [...moves.filter((m) => !inFlight(m.state)), ...receipts].filter((m) => nowMs - t(m.atIso) < DAY_MS).sort(newest);
  const unread = [...(r.ledger === "unread" ? ["Your moves couldn't be read just now."] : []), ...(r.spending === "unread" ? ["Moves between your wallets couldn't be read just now."] : [])];
  return { now: [...flying, ...running.sort(newest)], recent, moving: flying.length, unread, loading: r.ledger === null };
}

/** How long ago, short: "just now", "2 min", "3 h", "Mon". */
export function agoWords(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - t(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < DAY_MS / 1000) return `${Math.round(s / 3600)} h`;
  return new Date(t(iso)).toLocaleDateString("en-US", { weekday: "short" });
}

/**
 * The move a money sheet from the chat started: the newest move that began at or after the sheet was opened (a little
 * early, for the clocks), AgentZero's own first. Null: none yet (the sheet may have been closed; then nothing moved).
 */
export function startedSince(items: readonly JobItem[], sinceMs: number): JobItem | null {
  const after = items.filter((i) => i.kind === "move" && t(i.startedIso) >= sinceMs - 5_000);
  const ours = after.filter((i) => i.kind === "move" && i.by === "agentzero");
  return [...(ours.length ? ours : after)].sort((a, b) => t(b.startedIso) - t(a.startedIso))[0] ?? null;
}

/** What the email sheet says (pure, so node tests it): the address if there is one, and mail's real state. */
export const MAIL_WORDS = {
  title: "AgentZero's email",
  notLive: "AgentZero can get mail now. It can't send mail yet.",
  none: "AgentZero gets its email address, two words like name.word, the next time it opens.",
  unread: "AgentZero's email couldn't be read just now.",
  meanwhile: "A sign-in code mailed to AgentZero shows in its Inbox. Money sites like pump.fun use your own wallet, never this email.",
} as const;
/** Only what is still off is said (5 Nov: receiving is live, sending isn't). */
export function mailLines(address: string | null | undefined | "unread", sendLive: boolean = MAIL_SEND_LIVE): string[] {
  if (address === "unread") return [MAIL_WORDS.unread];
  if (address === undefined) return [];
  const has = typeof address === "string" && address.includes("@");
  if (!has) return [MAIL_WORDS.none];
  return sendLive ? [] : [MAIL_WORDS.notLive, MAIL_WORDS.meanwhile];
}
