// A NEAR coin's Rhea trade whose input was spent and whose coin out Ref kept on its side (the audit's MUST, 7 Nov: "no dead
// ends"; trade.near.rhea-kept). Loaded the first time such a card shows, never in Home's first load.
//
// Ref's claim path, verified on mainnet 7 Nov (v2.ref-finance.near's wasm, v1.9.21): a failed transfer out goes back to
// the wallet's own deposit at Ref when the wallet is registered there with room [inference: from the contract's own log
// lines, no failed transfer read], else to the wallet's lost and found at Ref ("Depositing to user lostfound account"),
// else, with too little free NEAR for that, to Ref's owner ("Depositing to owner") [inference, the same lines]. The
// wallet's lost and found: get_lostfound_token({ account_id, token_id }) reads it; claim_lostfound({ token_id }) with 1
// yocto, called by the wallet itself, has Ref send all of it to the wallet (a user's own claim tx read on mainnet). Only
// the owner's case needs Rhea's team (withdraw_owner_token is the owner's [inference: by its name]): no link is verified.
import type { TradeRecord } from "../service.ts";
import type { ChainEngine, Fill, Quote } from "../types.ts";

const KEPT = "trade.near.rhea-kept";

/** What Ref's lost and found holds of the kept trade's coin for the wallet, raw, read on both nodes; null: can't tell. */
export async function keptHeld(o: { rec: TradeRecord; engineOf: (chain: "near") => Promise<{ e: ChainEngine }> }): Promise<string | null> {
  const { rec } = o;
  if (rec.problem?.code !== KEPT || !rec.kept) return null;
  const { e } = await o.engineOf("near");
  const n = await e.keptHeld?.(rec.kept.token).catch(() => null);
  return n === null || n === undefined ? null : n.toString();
}

/**
 * The claim (the audit's MUST (3), 7 Nov): Ref's claim_lostfound through the core's signing path (the engine's claimKept), the
 * coin's arrival measured on both nodes. Ref sends the coin's WHOLE lost and found (the audit's MUST, 7 Nov), so every kept trade
 * of the same wallet and coin is covered by it: the measured rise is booked into the position ONCE, under the claim's own
 * key (claim:<tx hash>), and each of those trades is done, its own figure "about" its quote, its id marked applied so its
 * fill never books on its own; none of them shows the help step. Can't tell (no figure proven): undefined, nothing booked,
 * the cards stay and read Rhea again.
 */
/** How a claim ended (the audit's T8): the rise booked (`got`), sent with no read (`sent`), or the person said no (`declined`). */
export type ClaimEnd = { got: string } | { sent: true } | { declined: true };

export async function claimKept(o: {
  rec: TradeRecord; records: () => TradeRecord[]; engineOf: (chain: "near") => Promise<{ e: ChainEngine }>;
  bookInOrder: (rec: TradeRecord, q: Quote, f: Fill) => Promise<void>; save: () => Promise<void>;
  /** The claim's covered trades, kept in the book beside its booking (a crash before the records' save: recoverClaims). */
  covered: (hash: string, ids: string[]) => void;
  /** A covered trade closed as claimed: done, "about" its quote, its id applied (service.ts closeClaimed). */
  close: (x: TradeRecord, hash: string) => void;
}): Promise<ClaimEnd | undefined> {
  const { rec } = o;
  const k = rec.kept;
  if (rec.problem?.code !== KEPT || !k || !rec.quote || !rec.fill) return undefined;
  const { e } = await o.engineOf("near");
  const r = await e.claimKept?.(k.token);
  if (!r) return undefined;
  if ("declined" in r) return { declined: true };
  const all = o.records().filter((x) => x.problem?.code === KEPT && x.kept?.wallet === k.wallet && x.kept.token === k.token && x.quote && x.fill);
  // the audit's T8: sent, its end unread: each trade it covers remembers it, so its card never sends the person to Rhea's team
  // when the lost and found reads empty (the claim most likely took it)
  if ("sent" in r) { for (const x of all) x.kept!.claimSent = r.sent; await o.save(); return { sent: true }; }
  const spent = all.reduce((n, x) => n + BigInt(x.fill!.spent), 0n);
  o.covered(r.hash, all.map((x) => x.id));
  // one booking for the claim: the rise against what the trades it covers spent, in the first trade's wallet and coin
  // (a copy of the record under the claim's key: the trades' own records are never booked by it)
  await o.bookInOrder({ ...rec, id: `claim:${r.hash}` } as TradeRecord, rec.quote, { txHash: r.hash, got: r.got.toString(), spent: spent.toString(), fee: "0" });
  for (const x of all) o.close(x, r.hash);
  await o.save();
  return { got: r.got.toString() };
}
