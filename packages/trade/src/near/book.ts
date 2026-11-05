// A NEAR coin's Rhea trade in the service (loaded the first time one lands, never in Home's first load): done on the first
// node's executed answer, booked when another node's FINAL answer says the same (behind the receipt); one that says it
// didn't happen turns it to failed, and nothing was booked to undo.
// No runtime import of Trade's shared modules (the service hands it the problem): one would split them out of Home's
// first load into chunks of their own (its JS budget).
import type { Problem } from "@zerofee/core/problem";
import type { TradeRecord } from "../service.ts";
import type { Fill, Quote } from "../types.ts";

export async function bookLater(o: {
  rec: TradeRecord; r: { fill: Fill; timing?: { signedAt: number; sentAt: number; landedAt: number }; verify?: Promise<boolean | undefined> }; tapAt: number; reverted: Problem;
  save: () => Promise<void>; bookInOrder: (rec: TradeRecord, q: Quote, f: Fill) => Promise<void>;
  checking: Set<string>; verifying: Set<Promise<void>>; now: () => number;
}): Promise<TradeRecord> {
  const { rec } = o, fill = o.r.fill, q = rec.quote!, landedAt = o.r.timing?.landedAt ?? o.now();
  if (o.r.timing) rec.timing = { tapAt: o.tapAt, ...o.r.timing };
  Object.assign(rec, { status: "done", endedAt: landedAt, verifying: true as const, filledInMs: landedAt - o.tapAt });
  await o.save();
  o.checking.add(rec.id);
  const v: Promise<void> = (o.r.verify ?? Promise.resolve(undefined)).then(async (ok) => {
    if (ok === true) { await o.bookInOrder(rec, q, fill); delete rec.verifying; }
    else if (ok === false) { delete rec.fill; delete rec.filledInMs; delete rec.verifying; Object.assign(rec, { status: "failed", problem: o.reverted, endedAt: o.now() }); }
    await o.save();
  }).catch(() => undefined).finally(() => { o.verifying.delete(v); o.checking.delete(rec.id); });
  o.verifying.add(v);
  return rec;
}
