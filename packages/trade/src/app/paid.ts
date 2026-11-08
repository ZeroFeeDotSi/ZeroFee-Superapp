// Who gets a trade's fee, under its button (product decision, 5 Nov): the exchange
// the quote trades on (its fee is in its price), the network's own fee from the quote, and ZeroFee takes nothing. A NEAR
// coin priced by 1Click goes through NEAR Intents. The words are the core's one table (zero-fee.ts).
import { intentsPaid, tradePaid } from "@zerofee/core/zero-fee";

export function paidLine(q: { route: string; feeUsd: number }, network: string): string {
  if (q.route === "1Click") return intentsPaid();
  return tradePaid(q.route && q.route !== "Transfer" ? q.route : null, network, q.feeUsd);
}
