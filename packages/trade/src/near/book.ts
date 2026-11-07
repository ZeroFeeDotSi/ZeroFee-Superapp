// A NEAR coin's Rhea trade in the service (loaded the first time one lands, never in Home's first load): done on the first
// node's executed answer, booked when another node's FINAL answer says the same (behind the receipt); one that says it
// didn't happen turns it to failed, and nothing was booked to undo.
// No runtime import of Trade's shared modules (the service hands it the problem): one would split them out of Home's
// first load into chunks of their own (its JS budget).
import type { Problem } from "@zerofee/core/problem";
import type { TradeRecord } from "../service.ts";
import type { ChainEngine, FinalAgain, Fill, Quote } from "../types.ts";

export async function bookLater(o: {
  rec: TradeRecord; r: { fill: Fill; timing?: { signedAt: number; sentAt: number; landedAt: number }; verify?: Promise<boolean | undefined>; again?: FinalAgain }; tapAt: number; reverted: Problem;
  save: () => Promise<void>; bookInOrder: (rec: TradeRecord, q: Quote, f: Fill) => Promise<void>;
  checking: Set<string>; verifying: Set<Promise<void>>; now: () => number;
  /** Its check ended: its place in the coin's bookings is given up (service.ts, the audit's MUST, 7 Nov). */
  settle?: (rec: TradeRecord) => void;
}): Promise<TradeRecord> {
  const { rec } = o, fill = o.r.fill, q = rec.quote!, landedAt = o.r.timing?.landedAt ?? o.now();
  if (o.r.timing) rec.timing = { tapAt: o.tapAt, ...o.r.timing };
  // its hash, signer and ask kept (the audit's MUST, 7 Nov): after a restart another node's FINAL is asked again by them (followNear)
  Object.assign(rec, { status: "done", endedAt: landedAt, verifying: true as const, filledInMs: landedAt - o.tapAt, ...(o.r.again ? { again: o.r.again } : {}) });
  await o.save();
  o.checking.add(rec.id);
  const v: Promise<void> = (o.r.verify ?? Promise.resolve(undefined)).then(async (ok) => {
    if (ok === true) { await o.bookInOrder(rec, q, fill); delete rec.verifying; delete rec.again; }
    else if (ok === false) { delete rec.fill; delete rec.filledInMs; delete rec.verifying; delete rec.again; Object.assign(rec, { status: "failed", problem: o.reverted, endedAt: o.now() }); }
    await o.save();
  }).catch(() => undefined).finally(() => { o.verifying.delete(v); o.checking.delete(rec.id); o.settle?.(rec); });
  o.verifying.add(v);
  return rec;
}

/**
 * A NEAR coin's trade 1Click was still finishing, looked at by the core's move id (the service's resume and live look;
 * moved here unchanged from service.ts, 7 Nov, so it stays out of Home's first load).
 */
export async function followNear(o: {
  rec: TradeRecord; checking: Set<string>; engineOf: (chain: "near") => Promise<{ e: ChainEngine }>;
  bookOrDefer: (rec: TradeRecord, q: Quote, f: Fill) => Promise<void>; save: () => Promise<void>; now: () => number;
  takeSlot: (rec: TradeRecord) => void; settleSlot: (rec: TradeRecord) => void; reverted: (symbol: string) => Problem;
}): Promise<void> {
  const { rec } = o;
  if (o.checking.has(rec.id)) return;
  // its place in the coin's bookings (the audit's SHOULD, 7 Nov): booked in tap order like any other, never waited for here
  o.takeSlot(rec);
  o.checking.add(rec.id);
  try {
    const { e } = await o.engineOf("near").catch(() => ({ e: undefined }));
    // a Rhea trade whose FINAL check the app closed on (the audit's MUST, 7 Nov): asked again by its hash; booked only on FINAL,
    // failed on "didn't happen"; can't tell: kept (its place held inside the live window, owes), never on one node's word
    if (rec.verifying === true && rec.again) {
      const ok = await e?.finalAgain?.(rec.again, rec.fill!.got, rec.fill).catch(() => undefined);
      if (ok === undefined) return;
      delete rec.again;
      if (ok) await o.bookOrDefer(rec, rec.quote!, rec.fill!);
      else { delete rec.fill; delete rec.filledInMs; delete rec.verifying; Object.assign(rec, { status: "failed", problem: o.reverted(rec.symbol), endedAt: o.now() }); }
      await o.save();
      return;
    }
    // the core's move id is `fm-<key>` (review L5): followed, never asked for again
    const id = rec.hashes[0] ?? `fm-${`swap-${rec.id}`.padEnd(16, "0").slice(0, 64)}`;
    const f = await e?.followMove?.(id, rec.symbol).catch(() => "pending" as const);
    if (!f || f === "pending" || (rec.status !== "unconfirmed" && rec.status !== "sending")) return;
    if ("problem" in f) Object.assign(rec, { status: "failed", problem: f.problem, endedAt: o.now() });
    else { await o.bookOrDefer(rec, rec.quote!, f.fill); Object.assign(rec, { status: "done", endedAt: o.now() }); delete rec.problem; }
    await o.save();
  } finally { o.checking.delete(rec.id); o.settleSlot(rec); }
}
