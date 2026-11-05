// What a transfer_call really did. intents.near hands the coins over, lets the receiver say how much it keeps
// (mt_on_transfer), and gives the rest back in the same transaction; its mt_resolve_transfer answers the amounts kept
// (NEP-245). The core's answer is only the account contract's own, so the ledger reads the transaction's receipts
// itself, from two nodes that must agree.
//   kept     the resolve's answer. It wins over anything that fails after it (a receiver passing a paid transfer on, say):
//            the transfer was paid.
//   failed   no resolve, and a step was refused, so it didn't happen (NEAR sends back what a refused step carried).
//            The core already says so (security.send.partly); this is a second look.
//   ran      no resolve, and nothing failed
import { NODES, askOrderOf } from "@zerofee/core/chain";
import { INTENTS } from "@zerofee/core/intents";
import { ProblemError } from "@zerofee/core/problem";
import { walletProblems } from "./wallet-problems.ts";

export type CallResult = { kind: "kept"; units: bigint } | { kind: "failed" } | { kind: "ran" };

/** Null while the transaction can't be seen yet. Throws a Problem when the two nodes disagree. */
export type ReadCall = (txHash: string, signerId: string) => Promise<CallResult | null>;

/** From a `tx` answer (wait_until FINAL, so every receipt has run): what happened, or null if there's nothing to read. */
export function callResultOf(tx: any): CallResult | null {
  const outcomes: { id: string; outcome: any }[] = Array.isArray(tx?.receipts_outcome) ? tx.receipts_outcome : [];
  if (outcomes.length === 0) return null;
  const onLedger = outcomes.filter((r) => r?.outcome?.executor_id === INTENTS.account);
  // mt_transfer_call answers with its resolve's receipt; the resolve answers the amounts kept.
  for (const call of onLedger) {
    const next = call.outcome.status?.SuccessReceiptId;
    const resolve = typeof next === "string" ? onLedger.find((r) => r.id === next) : undefined;
    const value = resolve?.outcome.status?.SuccessValue;
    if (typeof value !== "string" || !value) continue;
    try {
      const kept = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))));
      if (Array.isArray(kept) && kept.length === 1 && typeof kept[0] === "string" && /^\d{1,39}$/.test(kept[0])) return { kind: "kept", units: BigInt(kept[0]) };
    } catch {
      // Not the resolve's answer: keep looking.
    }
  }
  const failed = outcomes.some((r) => r?.outcome?.status && typeof r.outcome.status === "object" && "Failure" in r.outcome.status);
  return { kind: failed ? "failed" : "ran" };
}

export function createReadCall(fetchFn: typeof fetch = (...a) => fetch(...a), nodes: string[] = NODES.mainnet): ReadCall {
  const ask = async (url: string, txHash: string, signerId: string): Promise<CallResult | null> => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "tx", params: { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" } }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json();
    if (body.error) throw new Error("not readable here");
    return callResultOf(body.result);
  };
  const key = (r: CallResult | null) => (r?.kind === "kept" ? r.units.toString() : String(r?.kind));

  return async (txHash, signerId) => {
    // Two answers from two operators; the third stands in when one is down.
    const answers: (CallResult | null)[] = [];
    // the app's one order (core's askOrderOf): on mainnet NEAR's own node before Intear (a real-money test, 4 Nov)
    for (const url of askOrderOf(nodes)) {
      if (answers.length === 2) break;
      try {
        answers.push(await ask(url, txHash, signerId));
      } catch {
        // Down, or hasn't seen it yet: the next node.
      }
    }
    if (answers.length < 2 || answers.includes(null)) return null;
    if (key(answers[0]) !== key(answers[1])) throw new ProblemError(walletProblems.nodesDisagree());
    return answers[0];
  };
}
