// The quiet Buy chip on a Trade list row (UI concept v3.1, Build A, QA/26 5 Nov): one tap buys the preset
// amount and the row becomes the receipt. The money rules: the chip calls the SAME svc.trade as the sheet,
// with origin `chip:<address>` in the one-tap lock's key, so a double tap on a chip is one trade and a chip beside an
// open sheet is a separate one; the checks are the sheet's (the quote must be checked; the core's refusal is said on the
// row, never a silent fail); the row's state follows the Receipt's words (away → landed / checking / refused).
// Pure: the chip's words and state machine; the row draws (Discover.tsx RowBuy).
import type { TradeRecord } from "../../service.ts";

/** What a chip buys is Settings' Quick buy amount (quick-buy.ts: $5 · $10 · $25 · $50, $25 by default). */
export { QUICK_BUY_DEFAULT as QUICK_BUY_USD } from "./quick-buy.ts";

export type RowBuyPhase = "away" | "landed" | "checking" | "refused";
export interface RowBuy {
  phase: RowBuyPhase;
  /** performance.now() at the tap. */
  at: number;
  /** The coins it is for ("about 7,505 DOPE" while away; "7,505 DOPE" once landed). */
  got?: string;
  /** From the tap to the chain's answer, once landed. */
  ms?: number;
  /** Why it was refused, in the core's words. */
  why?: string;
}

/** The row's one line under the name, for each phase. */
export function rowBuyLine(b: RowBuy, symbol: string): string {
  if (b.phase === "away") return b.got ? `On its way · about ${b.got}` : "On its way";
  if (b.phase === "landed") return `Bought · ${b.got ?? symbol}`;
  if (b.phase === "checking") return "Sent · still checking";
  return `Didn't buy · ${b.why ?? "Nothing left your wallet."}`;
}

/** The phase after the service answers: done = landed; unconfirmed = checking; declined/failed/expired = refused with
 *  the record's own words (a chain-landed failure took the fee, an expiry took nothing: the Receipt's rule). */
export function rowBuyEnd(rec: Pick<TradeRecord, "status" | "problem" | "hashes">): Pick<RowBuy, "phase" | "why"> {
  if (rec.status === "done") return { phase: "landed" };
  if (rec.status === "unconfirmed") return { phase: "checking" };
  if (rec.status === "declined") return { phase: "refused", why: "You said no. Nothing moved." };
  const feeTaken = rec.status === "failed" && (rec.hashes?.length ?? 0) > 0;
  return { phase: "refused", why: rec.problem?.whatHappened ?? (feeTaken ? "Only the network fee left your wallet." : "Nothing left your wallet.") };
}

/** A chip's buy that landed: every step ticked and the job ENDED done (QA's Sim crawl, 5 Nov:
 *  list buys stayed under "Now" for good and the Activity badge counted them for ever; the sheet's own buy ended, the
 *  chip's only updated its steps). The landing was read from the chain by the service (rowBuyEnd: status "done"). */
export function rowBuyLanded(tasks: { update: (id: string, patch: { detail?: string; proof?: { chain: string; hash: string }[]; steps?: { label: string; state: "done"; at: number }[] }) => boolean; end: (id: string, state: "done") => boolean } | undefined,
  taskId: string, o: { taskAt: number; now: number; wallet: string; detail: string; proof: { chain: string; hash: string }[] }): void {
  tasks?.update(taskId, { detail: o.detail, proof: o.proof, steps: [{ label: "Sent", state: "done", at: o.taskAt }, { label: "Landed", state: "done", at: o.now }, { label: o.wallet, state: "done", at: o.now }] });
  tasks?.end(taskId, "done");
}

/** How long a landed or refused row stays as the receipt before it is a row again (the person can open the coin any time). */
export const ROW_RECEIPT_MS = 6_000;
