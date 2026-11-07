// What a job may do by itself, and what needs the person's tap (the owner's HARD rule 1 for every job, within the audit's limits,
// 6 Nov). The one gate: anything a job's page or engine does without a tap asks it first. Pure: auto-actions.test.ts.
//
// AUTOMATIC only: re-reads; re-sending the same signed bytes; re-asking the core by the same job key; a hot key moving a
// 1Click REFUNDED amount back to the Safe by the move-home path (exact, once by key, said on the row); a hot-key retry to
// the person's OWN wallet only when the first is proven not gone, to the same place, at most the approved amount, after
// its backoff. NEEDS THE PERSON: any Safe signature, any retry to an outside payee, a new Safe fill, any changed amount or
// recipient. Money unknown: nothing moves by itself; it keeps reading.

export type AutoAction =
  | { kind: "re-read" }
  | { kind: "re-send"; sameBytes: boolean }
  | { kind: "re-ask"; sameKey: boolean }
  | { kind: "refund-home"; hotKey: boolean; refunded: boolean; exact: boolean; onceByKey: boolean; saidOnRow: boolean }
  | { kind: "own-retry"; hotKey: boolean; ownWallet: boolean; provenNotGone: boolean; samePlace: boolean; usd: number; approvedUsd: number; backoffDone: boolean }
  | { kind: "safe-sign" }
  | { kind: "payee-retry" }
  | { kind: "safe-fill" }
  | { kind: "changed"; what: "amount" | "recipient" };

/** `tapped`: the person tapped for this very action; `moneyKnown`: a read places the job's money (never automatic if not). */
export function mayRun(a: AutoAction, o: { tapped: boolean; moneyKnown: boolean }): { ok: boolean; why: string } {
  const no = (why: string) => ({ ok: false, why });
  if (a.kind === "re-read") return { ok: true, why: "a read moves nothing" };
  const person = a.kind === "safe-sign" || a.kind === "payee-retry" || a.kind === "safe-fill" || a.kind === "changed";
  if (person) return o.tapped ? { ok: true, why: "the person's tap" } : no("needs the person");
  if (!o.moneyKnown) return no("money unknown: keep reading");
  if (a.kind === "re-send") return a.sameBytes ? { ok: true, why: "the same signed bytes" } : no("new bytes need a signature");
  if (a.kind === "re-ask") return a.sameKey ? { ok: true, why: "the same job key" } : no("a new key is a new job");
  if (a.kind === "refund-home") return a.hotKey && a.refunded && a.exact && a.onceByKey && a.saidOnRow ? { ok: true, why: "a refund home, exact, once, said" } : no("refund home outside its limits");
  const ok = a.hotKey && a.ownWallet && a.provenNotGone && a.samePlace && a.usd > 0 && a.usd <= a.approvedUsd && a.backoffDone;
  return ok ? { ok: true, why: "own wallet, proven not gone, same place, within the approval" } : no("own-wallet retry outside its limits");
}
