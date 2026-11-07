// the audit's Trade audit T2 (8 Nov): a trade done on one node's word can still turn. Its two-node check says failed or expired
// (service.ts verify), its check goes back to "not confirmed", or its final read is never proven (unchecked: Ref kept the
// coin, or the final amount unchecked). The sheet and the list row ended its task "done" and nothing listened after that,
// so Jobs and the open receipt said "Bought" while Activity said otherwise. Here: the follow (by the record's id, until
// its check clears), what a turn says, and the task's rewrite. Pure: no React (TradeSheet and Discover draw it).
import type { TradeRecord, TradeService } from "../service.ts";

/** What a turned trade says. `task`: the Jobs row's end (failed: proven not traded, or Ref kept the coin; stopped: it may
 *  have traded, nothing proven); `detail`: the record's own words; `row`: the list row's phase (row-buy.ts); `moment`: the
 *  open receipt's (refused: the refused receipt; checking: "Still checking"; problem: the record's Problem card, as
 *  Activity's card says it); `feeTaken`: a chain-landed revert took its network fee. */
export interface Turn {
  task: "failed" | "stopped";
  detail: string;
  row: { phase: "refused" | "checking"; why?: string };
  moment: "refused" | "checking" | "problem";
  feeTaken: boolean;
}

const KEPT = "trade.near.rhea-kept";

/** The turn a record shows, or null while it is still checking or once it booked clean. */
export function turnOf(r: Pick<TradeRecord, "status" | "problem" | "hashes" | "verifying">): Turn | null {
  const words = r.problem?.whatHappened ?? "";
  if (r.status === "failed" || r.status === "expired") {
    const feeTaken = r.status === "failed" && (r.hashes?.length ?? 0) > 0;
    const why = words || (feeTaken ? "Only the network fee left your wallet." : "Nothing left your wallet.");
    return { task: "failed", detail: why, row: { phase: "refused", why }, moment: "refused", feeTaken };
  }
  if (r.status === "unconfirmed") return { task: "stopped", detail: words, row: { phase: "checking" }, moment: "checking", feeTaken: false };
  if (r.status === "done" && r.problem) {
    if (r.problem.code === KEPT) return { task: "failed", detail: words, row: { phase: "refused", why: words }, moment: "problem", feeTaken: false };
    return { task: "stopped", detail: words, row: { phase: "checking" }, moment: "problem", feeTaken: false };
  }
  return null;
}

/** Follows record `id` on the service's events while its check runs; `turned` once, the moment it turns; stops by itself
 *  once it booked clean (done, no check left, no problem), or with the returned stop. It looks once at the start too. */
export function followTurn(svc: Pick<TradeService, "on" | "activity">, id: string, turned: (rec: TradeRecord, t: Turn) => void): () => void {
  let over = false;
  const look = () => void svc.activity().then((all) => {
    if (over) return;
    const r = all.find((x) => x.id === id);
    if (!r) return;
    const t = turnOf(r);
    if (t) { stop(); turned(r, t); return; }
    if (r.status === "done" && !r.verifying) stop();
  }, () => undefined);
  const off = svc.on(look);
  const stop = () => { if (!over) { over = true; off(); } };
  look();
  return stop;
}

/** The Jobs row of a turned trade, rewritten whatever it said: Sent ticked; a trade proven not to land fails at Landed,
 *  one that landed fails (Ref kept the coin) or waits (unproven) at its wallet; its end and its words are the turn's. */
export function turnTask(tasks: { update: (id: string, patch: { detail?: string; steps?: { label: string; state: "waiting" | "doing" | "done" | "failed"; at?: number }[] }) => boolean; end: (id: string, state: "failed" | "stopped", detail?: string) => boolean } | undefined,
  taskId: string, t: Turn, o: { taskAt: number; wallet: string; now?: number }): void {
  const at = o.now ?? Date.now();
  const landed = t.row.phase === "refused" && t.moment === "refused";
  const steps = landed
    ? [{ label: "Sent", state: "done" as const, at: o.taskAt }, { label: "Landed", state: "failed" as const, at }, { label: o.wallet, state: "waiting" as const }]
    : [{ label: "Sent", state: "done" as const, at: o.taskAt }, { label: "Landed", state: t.moment === "checking" ? "doing" as const : "done" as const, at }, { label: o.wallet, state: t.task === "failed" ? "failed" as const : "waiting" as const, at }];
  tasks?.update(taskId, { ...(t.detail ? { detail: t.detail } : {}), steps });
  tasks?.end(taskId, t.task, t.detail || undefined);
}
