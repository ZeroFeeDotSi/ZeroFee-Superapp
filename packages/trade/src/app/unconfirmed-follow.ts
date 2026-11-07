// A trade the tap's wait gave up on ("unconfirmed", QA and the audit's MUST, 7 Nov): its card follows its record until
// the chain answers, while the service's live re-check looks at it (service.ts watch, RECHECK_MS). The card then ends at
// once: landed is the normal done; failed or proven expired is that Problem ("Buy stopped", one Try again).
// Pure: no React (the sheet and the list row use it; unconfirmed-live.test.ts).
import type { Problem } from "@zerofee/core/problem";
import type { RecordStatus, TradeRecord, TradeService } from "../service.ts";

/** trade-problems.ts unconfirmed's code: the thrown Problem of a trade that may still land. */
export const UNCONFIRMED = "trade.trade.unconfirmed";
/** A record still on its way: no end yet. */
const ON_ITS_WAY: ReadonlySet<RecordStatus> = new Set(["signing", "sending", "confirming", "unconfirmed"]);

/** The record a thrown unconfirmed Problem is about: the service keeps that very Problem on it (run()). */
export async function recordOf(svc: Pick<TradeService, "activity">, problem: Problem): Promise<TradeRecord | undefined> {
  return (await svc.activity()).find((r) => r.problem === problem);
}

/** Follows one record on the service's events until it ends; `end` once, with the ended record; `said` each time its
 *  Problem changes while it is still on its way. Returns the stop. It
 *  looks once at the start too: a record that ended between the throw and this follow (no event after it) still ends. */
export function followRecord(svc: Pick<TradeService, "on" | "activity">, id: string, end: (rec: TradeRecord) => void, said?: (rec: TradeRecord) => void): () => void {
  let over = false, last: unknown;
  const look = () => void svc.activity().then((all) => {
    if (over) return;
    const now = all.find((x) => x.id === id);
    if (!now) return;
    // `said`: still on its way, but its Problem's words changed (the live look stopped: "Open this again to check.")
    if (ON_ITS_WAY.has(now.status)) { if (last !== undefined && now.problem !== last && now.problem) said?.(now); last = now.problem ?? last; return; }
    over = true;
    off();
    end(now);
  });
  const off = svc.on(look);
  look();
  return () => { if (!over) { over = true; off(); } };
}
