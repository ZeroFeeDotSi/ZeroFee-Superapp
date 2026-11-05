// The payee pin (audit H4, 3 Nov): every private payment hands the core what the person asked to pay, from the quote
// request Wallet built from their own payee (never the relay's answer). The core signs only a 1Click-signed quote that
// pays exactly that (core private-pocket.ts payeeRefusal); a relay that swapped the recipient gets nothing signed.
import type { PayeeAsk } from "@zerofee/core/private-pocket";

/** The request's own payee, coin and (when the person asked an amount to arrive) that amount. */
export function payeeAsk(req: { recipient: string; recipientType: PayeeAsk["recipientType"]; destinationAsset: string }, minOut?: bigint): PayeeAsk {
  return { recipient: req.recipient, recipientType: req.recipientType, destinationAsset: req.destinationAsset, ...(minOut !== undefined ? { minAmountOut: minOut.toString() } : {}) };
}
