// The live re-check of one trade (service.ts: the round, while a card is on screen), moved here from service.ts (7 Nov)
// and loaded the first time a round looks at one, so it stays out of Home's first load (its JS budget). No runtime import
// of Trade's shared modules: the service hands them over (one would split them out of Home's first load).
import type { CHAINS as Chains, SubWallet, TradeRecord } from "./service.ts";
import type { tradeProblems as Problems } from "./trade-problems.ts";
import type { ChainEngine, ChainId, Fill, Quote } from "./types.ts";

/**
 * One trade, looked at again by the engine's history reads only. Ends it as the chain says: landed (done, its fill read
 * and booked), failed, or proven expired; anything else leaves it as it is. Nothing is signed or sent.
 * the audit's MUST (7 Nov): a trade two nodes already confirmed whose fill couldn't be read (verifying "fill") has only its fill
 * read again, and booked in its coin's order; its "done" and its time stay as they were.
 */
export async function recheckOne(o: {
  rec: TradeRecord; checking: Set<string>; now: () => number; CHAINS: typeof Chains; problems: typeof Problems;
  walletsOn: (chain: ChainId) => Promise<SubWallet[]>; engineOf: (chain: ChainId, w?: SubWallet) => Promise<{ e: ChainEngine }>;
  bookOrDefer: (rec: TradeRecord, q: Quote, f?: Fill) => Promise<void>; forget: (rec: TradeRecord) => void; save: () => Promise<void>;
  takeSlot: (rec: TradeRecord) => void; settleSlot: (rec: TradeRecord) => void;
}): Promise<void> {
  const { rec, now } = o;
  o.takeSlot(rec);
  o.checking.add(rec.id);
  try {
    const fillOnly = rec.verifying === "fill";
    const signer = rec.walletId ? (await o.walletsOn(rec.chain).catch(() => [])).find((w) => w.id === rec.walletId) : undefined;
    const { e } = await o.engineOf(rec.chain, signer).catch(() => ({ e: undefined }));
    if (!e || !(fillOnly || (e.recheck && rec.status === "unconfirmed"))) return;
    const last = rec.steps!.length - 1;
    const st = fillOnly ? "confirmed" : await e.recheck!(rec.hashes[last]!, rec.steps![last], rec.startedAt).catch(() => "unknown" as const);
    if (fillOnly ? rec.verifying !== "fill" : rec.status !== "unconfirmed") return;   // ended meanwhile (another look)
    if (st === "confirmed") {
      if (rec.quote && rec.kind !== "withdraw") {
        const f = await e.fill({ key: rec.id, at: rec.startedAt, quote: rec.quote, steps: rec.steps!, ready: async () => {} }, rec.hashes.at(-1)!).catch(() => undefined);
        // a fill not readable yet stays to be read (the next round, the next open); its turn not come yet: booked in the
        // background, still verifying (the audit's MUST, 7 Nov)
        await o.bookOrDefer(rec, rec.quote, f);
      }
      Object.assign(rec, { status: "done", endedAt: fillOnly ? rec.endedAt : now() });
      delete rec.problem;
    } else if (st === "failed" || st === "expired") {
      delete rec.verifying; delete rec.fill; delete rec.filledInMs;
      Object.assign(rec, { status: st, problem: st === "failed" ? o.problems.reverted(rec.symbol) : o.problems.expired(rec.symbol, o.CHAINS[rec.chain].name), endedAt: now() });
    } else return;
    o.forget(rec);
    await o.save();
  } finally {
    o.checking.delete(rec.id);
    o.settleSlot(rec);
  }
}
