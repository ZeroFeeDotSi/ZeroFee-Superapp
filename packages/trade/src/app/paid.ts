// Who gets a trade's fee, under its button (product decision, 5 Nov): the exchange
// the quote trades on (its fee is in its price), the network's own fee from the quote, and ZeroFee takes nothing. A NEAR
// coin priced by 1Click goes through NEAR Intents. The words are the core's one table (zero-fee.ts).
import { intentsPaid, tradePaid } from "@zerofee/core/zero-fee";

export function paidLine(q: { route: string; feeUsd: number }, network: string): string {
  if (q.route === "1Click") return intentsPaid();
  return tradePaid(q.route && q.route !== "Transfer" ? q.route : null, network, q.feeUsd);
}

/** The one line under the amount: what you get (or give), then the fee after a dot. With no head yet (a sale before the
 *  holding is read), the fee stands alone, "Fee $0.002": a dot never leads a line (UI audit 5 Nov). */
export function getLine(head: string, fee: string): { head: string; fee: string } {
  return head ? { head, fee: ` · ${fee} fee` } : { head: "", fee: `Fee ${fee}` };
}

/** A sale's line under its figure (T2-4, the copy review's walk): the coins, then its fee said once in the copy review's form, "7,505 DOPE · Fee
 *  $0.002"; with no holding read yet, "Fee $0.002" alone (a dot never leads a line). */
export function saleLine(head: string, fee: string): { head: string; fee: string } {
  return head ? { head, fee: ` · Fee ${fee}` } : { head: "", fee: `Fee ${fee}` };
}
