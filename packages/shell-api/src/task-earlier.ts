// The Activity centre's Earlier part (the review's ruling, 4 Nov, R2): Home's money history is the record (its proof,
// From/To/Fee, the statement), so while it is drawn, Earlier leaves out Home's finished tasks (done, failed, stopped):
// they showed twice, as a card with "Done" and again as a row. Now keeps Home's live ones. Another app's finished cards
// stay unless the centre draws that app's own history (Trade's trades): then its done ones are those rows, so they go.
// Loaded with the centre (TaskCentre.tsx).
// A web wallet's Send ("web-send:<tx>", web-send.ts; private, the core's own 1Click quote) has no row in Home's history (the core keeps no record of
// it), so its card stays: it is that send's only record, with its proof (QA, 4 Nov: Activity said "Nothing yet").
import type { Task } from "./tasks.ts";

/** A Home task that is its own record: never in Home's history, so never hidden for it. */
export const OWN_RECORD = /^web-send:/;

/** Trade's Buy or Sell of a coin in the Safe (native/swap.ts runSwap, "native-buy-…"): the Safe's own swap (ledger.swap),
 *  so its record is a row in Home's history. Done, that row is the one row (Sim re-check, 5 Nov: one Buy was two rows,
 *  "Buy $25.00 of BTC" here and "Converted" under Money). One that failed stays: it may have stopped before any swap. */
export const SAFE_SWAP = /^native-(buy|sell)-/;

/** `drawn`: the other apps whose own history the centre draws (Trade's trades): their done tasks are those records, so
 *  they leave Earlier (lap FAIL 4, QA 5 Nov: each trade was listed twice, a task row and a trade row). One that
 *  didn't finish stays: it has no record there. */
/** `recorded` (the audit's Trade audit T11, 8 Nov): the tasks each drawn app's history has a record for (history-slot.ts
 *  setAppRecorded). One of those that failed or stopped is that record's row too ("Didn't buy DOPE"), so it leaves Earlier
 *  as a done one does: a reverted buy was "Buy $5 of DOPE · DOPE didn't buy…" here and "Didn't buy DOPE" under Trade.
 *  One with no record (said no before a record, the app closed first) stays: it is its only row. */
export const earlierOf = (tasks: readonly Task[], homeHistory: boolean, drawn: ReadonlySet<string> = new Set(), recorded: ReadonlyMap<string, ReadonlySet<string>> = new Map()): Task[] =>
  tasks.filter((t) => t.state !== "pending" && !(homeHistory && ((t.app === "home" && !OWN_RECORD.test(t.id)) || (t.app === "trade" && t.state === "done" && SAFE_SWAP.test(t.id)))) && !(t.app !== "home" && drawn.has(t.app) && (t.state === "done" || !!recorded.get(t.app)?.has(t.id))));
