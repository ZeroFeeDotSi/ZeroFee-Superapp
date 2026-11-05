// Jobs and limits' rows that aren't the engine's (QA 5 Nov):
// - Receipts: AgentZero's paid replies live in Activity (apps/web az-tasks.ts replyReceipt, ids "agentzero:reply:…"),
//   so the page said "Nothing yet" beside nine paid rows; it lists them too, read from the same tasks.
// - Its wallet: a higher limit waits the account's safety wait; until it starts, the row says both figures (it showed
//   the new one at once while the sheet said 3 days).
import type { Task } from "@zerofee/shell-api/tasks.ts";
import type { Receipt } from "../zero/receipts.ts";

/** A paid reply's row as the page lists it (its Activity task's own title, dollars and time). */
export type ReplyRow = { id: string; title: string; usd?: string; atMs: number };

/** AgentZero's paid replies among the Activity tasks, newest first; anything else (its jobs, money asks, other apps) left out. */
export function replyRows(tasks: readonly Task[]): ReplyRow[] {
  return tasks
    .filter((t) => t.app === "agentzero" && t.id.startsWith("agentzero:reply:") && t.state === "done")
    .map((t) => ({ id: t.id, title: t.title, ...(t.usd ? { usd: t.usd } : {}), atMs: t.endedAt ?? t.startedAt }))
    .sort((a, b) => b.atMs - a.atMs);
}

/** The Receipts list: the engine's receipts and the paid replies, newest first, `n` at most. */
export type PageRow = { kind: "receipt"; r: Receipt; atMs: number } | { kind: "reply"; r: ReplyRow; atMs: number };
export function pageRows(receipts: readonly Receipt[], replies: readonly ReplyRow[], n = 12): PageRow[] {
  const ms = (iso: string) => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : 0);
  return [...receipts.map((r): PageRow => ({ kind: "receipt", r, atMs: ms(r.atIso) })), ...replies.map((r): PageRow => ({ kind: "reply", r, atMs: r.atMs }))]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, n);
}

/** A higher its wallet waiting its safety wait, as this phone asked it. */
export type Raise = { usd: number; atIso: string };
export const RAISE_KEY = "agent-pocket-raise";
export function readRaise(raw: string | null | undefined): Raise | null {
  try {
    const j = raw ? (JSON.parse(raw) as Partial<Raise>) : null;
    return j && typeof j.usd === "number" && j.usd > 0 && typeof j.atIso === "string" && Number.isFinite(Date.parse(j.atIso)) ? { usd: j.usd, atIso: j.atIso } : null;
  } catch {
    return null;
  }
}
/** The raise still to show: none once the account has it (or more), or once AgentZero is off. */
export const raiseShown = (r: Raise | null, on: boolean, limitUsd: number): Raise | null => (r && on && r.usd > limitUsd + 1e-9 ? r : null);
