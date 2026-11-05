// Bug report (5 Nov): an Add is saved before the Safe signs
// (float-core.ts add()). One whose page closed meanwhile is checked here, loaded with its first use, never in Home's
// first load (the speed budget). Its job's key finds 1Click's quote the core kept (its deposit address); then:
// - 1Click says it settled, came back or failed: the row goes on from there (its legs as ever, once it is in the NEAR
//   wallet);
// - still waiting: the chain is asked (QA's MUST: never "nothing moved" on 1Click's word alone): the Safe's own
//   record of a payment means it went (on its way); none, once 1Click's price ran out, means it was never sent; a read
//   that can't tell (a failed read, or the address's storage alone: the audit's note 1), once the price ran out, says where a
//   late payment goes and keeps watching.
// No quote kept for the job: it never reached a sheet (the quote is kept before one), so the row goes without a word.
// Types only from the engine: its values come in the host (as float-two.ts), so nothing of it splits out of Home's chunk.
import type { MoveRow } from "./float-view.ts";
import type { AddMovementEnd } from "./float-core.ts";

/** Asked about this often; its payment given this long to land first; "never sent" said only this long after 1Click's
 *  price ran out (then nothing can still take it). */
export const SIGNING_EVERY_MS = 30_000;
export const SIGNING_SETTLE_MS = 2 * 60_000;
export const SIGNING_LATE_MS = 10 * 60_000;
/** Its end words (copywriter, the product rule: the protocol by name; QA's MUST: only on the chain's word). */
export const SIGNING_WORDS = {
  notSent: "It wasn't sent. Nothing left your Safe",
  ifSent: "If your Safe sent it, it lands in your NEAR wallet",
} as const;
const DEPOSIT = /^[0-9a-f]{64}$/;

export interface SigningHost {
  adds: MoveRow[];
  /** The Adds this page is asking the Safe for now: never checked here. */
  asking: ReadonlySet<string>;
  now(): number;
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** Heard landed (float-core's landing rules then move it on, its legs with it). */
  landed: Map<MoveRow, number>;
  /** Followed by its deposit address (float-core addsFromCore), or no longer. */
  follow(r: MoveRow): void;
  unfollow(r: MoveRow): void;
  begin(): void;
  changed(): void;
  addEnd(m: AddMovementEnd): Pick<MoveRow, "status" | "where" | "note"> & { stayed?: true };
}

export async function signingCheck(h: SigningHost): Promise<void> {
  const now = h.now();
  for (const r of [...h.adds]) {
    const s = r.signing;
    if (!s || h.asking.has(r.id) || now - (s.checkedAt ?? 0) < SIGNING_EVERY_MS) continue;
    s.orphan = true;
    s.checkedAt = now;
    const st = await h.call<{ status: string; depositAddress?: string; tokenId?: string; deadlineMs?: number } | null>("subwallet.float.addStatus", { job: s.job }).catch(() => undefined);
    if (st === undefined) continue;
    if (st === null) { h.adds.splice(h.adds.indexOf(r), 1); h.changed(); continue; }
    if (st.depositAddress && DEPOSIT.test(st.depositAddress)) r.deposit = st.depositAddress;
    if (st.tokenId) s.tokenId = st.tokenId;
    const went = () => { delete r.signing; Object.assign(r, { status: "moving", where: "in-flight" }); h.follow(r); h.begin(); h.changed(); };
    if (st.status === "done") { went(); h.landed.set(r, now); h.unfollow(r); continue; }
    if (st.status === "refunded" || st.status === "failed") { delete r.signing; Object.assign(r, h.addEnd({ status: st.status === "refunded" ? "refunded" : "problem", ...(r.deposit ? { depositAddress: r.deposit } : {}) })); h.changed(); continue; }
    // still waiting on 1Click: a page that closed may still have its payment on the way for a moment
    if (now - s.at < SIGNING_SETTLE_MS || !r.deposit) continue;
    const sent = await h.call<"none" | "found" | "unknown">("ledger.addSent", { depositAddress: r.deposit, ...(s.tokenId ? { tokenId: s.tokenId } : {}), sinceIso: new Date(s.at).toISOString() }).catch(() => "unknown" as const);
    const ranOut = now > (st.deadlineMs ?? s.at + 10 * 60_000) + SIGNING_LATE_MS;
    if (sent === "found") { went(); continue; }
    if (!ranOut) continue;
    if (sent === "none") { delete r.signing; Object.assign(r, { status: "failed", where: "main", stayed: true, note: SIGNING_WORDS.notSent }); h.changed(); continue; }
    if (!s.late) { s.late = true; r.note = SIGNING_WORDS.ifSent; h.changed(); }
  }
}
