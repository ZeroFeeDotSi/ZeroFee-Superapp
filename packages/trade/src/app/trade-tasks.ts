// the audit's Trade audit T12 (8 Nov), with QA 16's MUST on T2: a trade's Jobs row is kept to its record by Trade's runtime, not
// by the screen that made it. The sheet and the list row followed a trade only while mounted, and "trade-…" ids are never
// ended by job-start's endOrphans, so a closed sheet, a row scrolled away or a reload left "Not confirmed yet" in Now for
// good, and a turn after "done" was lost on a reload. Each record carries its task's id (svc.trade's `task`); on every
// change of the service, and once at the start, each task is brought to its record: landed (done, every step ticked),
// turned (trade-turn.ts turnTask), said no (stopped). A task from before this run that no record stands for ends with
// where the money is. A live tap's own screen ends its task first (the sheet's 1.6 s); the keeper only past KEEP_GRACE_MS.
// The same keeper ends a lost-and-found claim's row a closed page left (builder 4's open edge, 8 Nov): by its record,
// done, "Check Activity" (sent, end unread) or nothing was sent.
import { taskStore, type Task, type Tasks } from "@zerofee/shell-api/tasks.ts";
import { setAppRecorded } from "@zerofee/shell-api/history-slot.ts";
import type { TradeRecord, TradeService } from "../service.ts";
import { turnOf, turnTask } from "./trade-turn.ts";

/** How long after a landing the screen's own ending has before the keeper ends a task still going. */
export const KEEP_GRACE_MS = 5_000;
/** A task from before this run that no trade record stands for, and no trade began near it: nothing was signed. */
export const CLOSED_WORDS = "The app closed before it was sent. Nothing was spent.";
/** A task from before this run that no record names, with a trade begun near it (one made before records carried their
 *  task): what it did isn't proven (job-start.ts JOB_WORDS.mayHaveMoved's words). */
export const UNSURE_WORDS = "Check Activity for where this is.";
/** How far after its task a tap's record can begin (the quote, then the tap) and still be that task's. */
const NEAR_MS = 60_000;
const SLACK_MS = 5_000;

/** The going trade rows' ids, as one string (a stable snapshot for Activity's useSyncExternalStore, T11). */
export const goingIds = (tasks: readonly { id: string; app: string; state: string }[]): string =>
  tasks.filter((t) => t.app === "trade" && t.state === "pending").map((t) => t.id).join("\n");

/** A lost-and-found claim's Jobs row: "claim-<the kept record's id>-<the tap, epoch ms>" (screens/JobCard.tsx). */
export const CLAIM_PREFIX = "claim-";
/** The record a claim's row was made for (its id between the prefix and the tap's time). */
export const claimRecord = (all: readonly TradeRecord[], taskId: string): TradeRecord | undefined => {
  const id = taskId.slice(CLAIM_PREFIX.length).replace(/-\d+$/, "");
  return all.find((r) => r.id === id);
};

type Timer = { set(f: () => void, ms: number): unknown; clear(h: unknown): void };
type KeepOpts = { now?: () => number; list?: () => Task[]; timer?: Timer };

/** One keeper per trade service (QA 16's MUST, 8 Nov): the shell's, from Home's start (trade-follow.ts), and Trade's own
 *  (TradeProvider) share it; it stops when the last one lets go. */
const KEEPERS = new WeakMap<object, { n: number; stop: () => void }>();
/** "Before this run": before this page loaded, so a keeper started again later (Trade's screen remounted) never takes a
 *  tap of this page for one a closed page left. */
const pageBorn = () => globalThis.performance?.timeOrigin ?? Date.now();

export function keepTradeTasks(svc: Pick<TradeService, "on" | "activity">, tasks: Pick<Tasks, "update" | "end">, o: KeepOpts = {}): () => void {
  let k = KEEPERS.get(svc);
  if (!k) { k = { n: 0, stop: keepOne(svc, tasks, o) }; KEEPERS.set(svc, k); }
  k.n++;
  const mine = k;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--mine.n === 0) { mine.stop(); if (KEEPERS.get(svc) === mine) KEEPERS.delete(svc); }
  };
}

function keepOne(svc: Pick<TradeService, "on" | "activity">, tasks: Pick<Tasks, "update" | "end">, o: KeepOpts): () => void {
  const now = o.now ?? Date.now;
  const list = o.list ?? (() => taskStore().list());
  const timer: Timer = o.timer ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const born = o.now ? now() : pageBorn();
  let swept = false, over = false, wake: unknown;
  const walletOf = (t: Task) => t.steps[2]?.label ?? "In your wallet";
  const endDone = (t: Task) => {
    const at = now();
    tasks.update(t.id, { steps: [{ label: t.steps[0]?.label ?? "Sent", state: "done", at: t.steps[0]?.at ?? t.startedAt }, { label: t.steps[1]?.label ?? "Landed", state: "done", at: t.steps[1]?.at ?? at }, { label: walletOf(t), state: "done", at }] });
    tasks.end(t.id, "done");
  };
  /** the audit's T8 edge (builder 4's open edge, 8 Nov): a claim's row the app closed under. Its coin came back (the record was
   *  closed as claimed): done. The claim went out and its end was never read (kept.claimSent): Activity. Else nothing was
   *  sent (the claim only ever brings a coin back; it spends 1 yocto and gas only once it is sent). */
  const endClaim = (t: Task, r: TradeRecord | undefined) => {
    if (r?.claimed) {
      const at = now();
      tasks.update(t.id, { steps: t.steps.map((x) => ({ ...x, state: "done" as const, at: x.at ?? at })) });
      tasks.end(t.id, "done");
    } else tasks.end(t.id, "stopped", r?.kept?.claimSent ? UNSURE_WORDS : CLOSED_WORDS);
  };
  const keep = (all: readonly TradeRecord[]) => {
    // T11: the rows Trade's history has a record for, so the Activity centre lists each trade once
    setAppRecorded("trade", new Set(all.flatMap((r) => (r.task ? [r.task] : []))));
    const mine = new Map(list().filter((t) => t.app === "trade" && t.id.startsWith("trade-")).map((t) => [t.id, t]));
    let next = Infinity;
    for (const r of all) {
      const t = r.task ? mine.get(r.task) : undefined;
      if (!t) continue;
      const turn = turnOf(r);
      // still not confirmed: going (the service's looks end it); back to it after "done": the turn's words
      if (turn && (r.status !== "unconfirmed" || t.state === "done")) {
        if (t.state !== turn.task || (turn.detail && t.detail !== turn.detail)) turnTask(tasks, t.id, turn, { taskAt: t.steps[0]?.at ?? t.startedAt, wallet: walletOf(t), now: now() });
        continue;
      }
      if (t.state !== "pending") continue;
      if (r.status === "declined") { tasks.end(t.id, "stopped", "You said no. Nothing moved."); continue; }
      if (r.status === "done") {
        const landed = r.timing?.landedAt ?? r.endedAt ?? r.startedAt;
        const due = t.startedAt < born ? 0 : landed + KEEP_GRACE_MS - now();
        if (due <= 0) endDone(t); else next = Math.min(next, due);
      }
    }
    // once, at the start: tasks a closed page left that no record names
    if (!swept) {
      swept = true;
      const named = new Set(all.map((r) => r.task).filter(Boolean));
      for (const t of mine.values()) {
        if (t.state !== "pending" || t.startedAt >= born || named.has(t.id)) continue;
        const near = all.some((r) => !r.task && r.startedAt >= t.startedAt - SLACK_MS && r.startedAt <= t.startedAt + NEAR_MS);
        tasks.end(t.id, "stopped", near ? UNSURE_WORDS : CLOSED_WORDS);
      }
      // a lost-and-found claim's row ("claim-<record>-<tap>", JobCard's) a closed page left: ended by what its record says
      for (const t of list()) {
        if (t.app !== "trade" || !t.id.startsWith(CLAIM_PREFIX) || t.state !== "pending" || t.startedAt >= born) continue;
        endClaim(t, claimRecord(all, t.id));
      }
    }
    if (next < Infinity) { timer.clear(wake); wake = timer.set(look, next + 1); }
  };
  const look = () => void svc.activity().then((all) => { if (!over) keep(all); }, () => undefined);
  const off = svc.on(look);
  look();
  return () => { over = true; off(); timer.clear(wake); };
}
