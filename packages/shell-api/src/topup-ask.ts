// The Safe-only top-ups' ask (Home's Spending, Trade's Add): its own module, off Home's first load (the speed budget).
import type { Problem } from "@zerofee/core/problem";
import { moneyMayHaveMoved } from "@zerofee/core/money-calls";

/** A job's own key (TxRequest.job's form: 16 to 64 of A-Za-z0-9_-), `<prefix>-` and 24 random hex. */
export const jobKey = (prefix: string): string => `${prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
/** A Safe-only "Move to your NEAR wallet" (Home's Spending and Trade's Add; the audit's SHOULD, 7 Nov): spending.topUp with the
 *  job's own key, the key runJob hears approval.asked and job.signed by. One key per amount (`keys`: the sheet's own): a
 *  retry of the same amount is the same move (the core's key check), another amount another key. */
export function topUpAsk(keys: Map<string, string>, usd: string | null, prefix: string): { key: string; params: { usd: string | null; key: string } } {
  let key = keys.get(String(usd));
  if (!key) keys.set(String(usd), (key = jobKey(prefix)));
  return { key, params: { usd, key } };
}
/** the audit's MUST (7 Nov): a try whose move went (the core said yes) drops its amount's key, so the same amount asked again on
 *  purpose is a second move, never the first one handed back. A refusal after its job was made drops it only when it
 *  proves nothing moved (!moneyMayHaveMoved); one that may have moved keeps it, so the same amount again is the core's
 *  existing move, never a second pay. Refused before its job, or declined: kept (its retry is the same move). */
export function topUpEnded(keys: Map<string, string>, usd: string | null, end: object): void {
  if ("ok" in end || ("problem" in end && !moneyMayHaveMoved(end.problem as Problem))) keys.delete(String(usd));
}
