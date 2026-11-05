// AgentZero's tasks, live (az-tasks.ts makes them; this reads the phone): the moves a money ask started, as Home reads
// them (for the chat's card), and what a restart left: money asks from before one task per move are ended, a pay sheet's
// task is settled from AgentZero's receipts. Reads only.
import type { Bridge } from "@zerofee/core/bridge";
import { LIMITS, withinOr } from "@zerofee/agent/chat/wait";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "@zerofee/wallet/types.ts";
import { legMove } from "./money-ask.ts";
import { moneyTask, payPhase, payReceipt, SHEET_OPEN, type AskKeep, type Tasks } from "./az-tasks.ts";
import type { Receipt } from "@zerofee/agent/zero/receipts";

/** Every move a sheet can start, as Home reads them (Activity's, and the wallet legs from Spending's own record); `read`:
 *  Activity answered (a failed read is never a step). */
export async function readMoves(bridge: Bridge): Promise<{ rows: Movement[]; legsRead: boolean; read: boolean }> {
  // wait.ts: each read within the core's limit; a late one is a failed read (never a step), so a follow never stalls
  const [a, l] = await Promise.all([withinOr(bridge.call<Movement[]>("ledger.activity", { limit: 30 }), LIMITS.core, "Activity", null), withinOr(bridge.call<SpendingActivity[]>("spending.activity", {}), LIMITS.core, "Your wallets", null)]);
  const read = !!a && "ok" in a && Array.isArray(a.ok);
  const legsRead = !!l && "ok" in l && Array.isArray(l.ok);
  return { rows: [...(read ? (a.ok as Movement[]) : []), ...(legsRead ? (l.ok as SpendingActivity[]).map(legMove) : [])], legsRead, read };
}

/**
 * After a restart: a money ask kept from before one task per move (review, 3 Nov) is ended "stopped", with no line,
 * and dropped (its move is Home's or Trade's task); a pay sheet's task is settled from AgentZero's receipts
 * (settlePays); any other ask still in flight goes on under its own task id (updated, never published again).
 */
export function resumeAsks(tasks: Tasks | null, keep: AskKeep): number {
  if (!tasks) return 0;
  const kept = keep.all();
  for (const k of kept) {
    if (k.sheet === "pay") continue;
    tasks.end(k.id, "stopped");
    keep.drop(k.id);
  }
  return kept.length;
}

/** A pay sheet's kept task after a restart: its receipt settles it; none (and its two minutes gone), it stops, said. */
export function settlePays(tasks: Tasks | null, keep: AskKeep, receipts: readonly Receipt[], now: number = Date.now()): void {
  if (!tasks) return;
  for (const k of keep.all().filter((x) => x.sheet === "pay")) {
    const task = moneyTask(tasks, k.ask, { keep, again: k, openLabel: SHEET_OPEN });
    const r = payReceipt(receipts, k.since ?? k.at);
    const p = payPhase(r, { closedAt: k.since ?? k.at, now });
    if (p === "opened") task.to("lost", "AgentZero restarted before it saw the end. Its receipts in Jobs and limits say if it paid.");
    else task.to(p, p === "closed" ? "Nothing was paid." : r?.title);
  }
}
