// A receipt's words (UI concept v3.1; the reviewer's MUST (a), 5 Nov): what the sheet says at each step of a one-tap
// trade. Optimistic is never done: at 80 ms the sheet says the trade is on its way; "Bought"/"Sold" and the landed time
// come only from the chain's confirmed answer; "Nothing left your wallet" only once a refusal is confirmed.
// "checking" (the reviewer, 5 Nov): a timeout, a 5xx or a lost answer AFTER broadcast is not a refusal. The sheet keeps
// waiting on the chain and says so. "refused" is only the core's refusal before signing, or the chain's confirmed
// answer that the trade failed or expired. Two refusals, two lines (QA, 5 Nov): a trade the chain confirmed as
// FAILED after a hash is a reverted transaction, so the network fee WAS taken (feeTaken: "Only the network fee left your
// wallet"); one that EXPIRED never landed, so nothing was taken ("Nothing left your wallet"). A dropped transaction is
// "expired", never "failed": the service maps it so, and the words here trust that.
export type ReceiptState = "away" | "checking" | "landed" | "refused";

export interface ReceiptWords {
  /** The caption under the amount: "On its way", "Bought", "DOPE didn't buy". */
  head: string;
  /** The line under it: the coin amount and where it is, or what happened. */
  line: string;
  /** The chain line: "Landed in 1.05 s", or the still-waiting dot's text. */
  chain: string;
  /** The lit verb for this state (one per screen): Done on landed; Try again on refused; none while away. */
  verb: "Done" | "Try again" | null;
}

/** `feeTaken`: the chain landed the trade and failed it, so its network fee (and any priority fee) left the wallet (QA,
 *  5 Nov: "Nothing left your wallet" is false there); `feeUsd` names it when the fill was read. Without `feeTaken` a refusal
 *  is one the core made before signing, or an expired send that never landed: nothing left. */
/** `about` (the audit's Trade audit T1, 8 Nov): landed on one node's word, the coins are the quote's until the chain's read, so
 *  the line says "About 7,505 DOPE", never the quote as fact. */
export function receiptWords(a: { state: ReceiptState; side: "buy" | "sell"; coin: string; coinAmount: string; where: string; landedMs?: number; feeTaken?: boolean; feeUsd?: string; about?: boolean }): ReceiptWords {
  const did = a.side === "buy" ? "Bought" : "Sold";
  if (a.state === "landed") {
    const ms = a.landedMs ?? 0;
    return { head: did, line: `${a.about ? "About " : ""}${a.coinAmount} ${a.coin} · ${a.side === "buy" ? "in" : "from"} ${a.where}`, chain: `Landed in ${(ms / 1000).toFixed(2)} s`, verb: "Done" };
  }
  if (a.state === "refused") {
    const line = a.feeTaken ? `Only the network fee${a.feeUsd ? ` (${a.feeUsd})` : ""} left your wallet.` : "Nothing left your wallet.";
    return { head: `${a.coin} didn't ${a.side}`, line, chain: "", verb: "Try again" };
  }
  if (a.state === "checking") {
    return { head: "Still checking", line: `About ${a.coinAmount} ${a.coin}`, chain: "Waiting for the chain", verb: null };
  }
  return { head: "On its way", line: `About ${a.coinAmount} ${a.coin}`, chain: "Waiting for the chain", verb: null };
}
