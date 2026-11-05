// S2 (real money, 4 Nov, zf-0000000a01.near): what AgentZero's tab knows about its wallet, from the core's one read
// (account.agent.view). Its wallet is release 10's; a release 9 account (every account opened today) has none, and the
// core says so (security.method.unknown, finding 13). The tab offers "Turn on" ONLY when the read answered: a read that
// failed (a busy node, the relay) or never answered used to leave "Looking at your account…" for good, or offer Turn on
// to a release 9 account, whose Approve then ended on "This part of the app isn't ready yet."
import type { Problem } from "@zerofee/core/problem";

export type PocketRead =
  /** the read is on its way */
  | { k: "reading" }
  /** the account's rules have no its wallet (release 9): only the jobs that need none */
  | { k: "none" }
  /** the read answered: the contract's agent view (null: AgentZero off) */
  | { k: "known"; view: unknown }
  /** the read failed or didn't answer in time: say why, offer Try again, never Turn on */
  | { k: "unread"; problem: Problem | null };

/** How long the tab waits for the read before it says so (a stuck read must end with an answer). */
export const POCKET_READ_MS = 15_000;

/** The read's answer, or "late" when it didn't come in `ms`; a throw counts as a failed read. */
export async function readWithin<T>(p: Promise<T>, ms = POCKET_READ_MS): Promise<T | "late" | "threw"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => "threw" as const), new Promise<"late">((r) => (timer = setTimeout(() => r("late"), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The tab's state from the view call's result. */
export function pocketFrom(r: { ok: unknown } | { problem: Problem } | "late" | "threw"): PocketRead {
  if (r === "late" || r === "threw") return { k: "unread", problem: null };
  if ("problem" in r) return r.problem.code === "security.method.unknown" ? { k: "none" } : { k: "unread", problem: r.problem };
  return { k: "known", view: r.ok };
}

/** Turn on (and the its wallet sheet) only once the read answered that this account can hold its wallet. */
export const offersTurnOn = (r: PocketRead): boolean => r.k === "known";

/** QA (5 Nov): the dispute's end from the core's view (`disputeUntilNs`, the contract's `dispute_until`, in
 *  nanoseconds), while it is still ahead; `agent()` says paused: false through it, yet agent_pay is refused. */
export function pausedUntil(ns: unknown, nowMs = Date.now()): { pausedUntilIso: string } | Record<string, never> {
  const ms = typeof ns === "string" && /^\d+$/.test(ns) ? Number(BigInt(ns) / 1_000_000n) : NaN;
  return Number.isFinite(ms) && ms > nowMs ? { pausedUntilIso: new Date(ms).toISOString() } : {};
}
