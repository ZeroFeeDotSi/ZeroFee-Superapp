// The money sheet's Close while what it asked for is still getting ready (phone test, 3 Nov: "Put money in
// pump.fun" sat on a slow quote, its ✕ did nothing, and the tester had to force-quit). The sheet now closes at once, whatever is
// in flight; and anything it started that hasn't been signed yet asks for nothing after that: the ledger's next
// signature request (signAll) answers as a No, so no Approve or Face ID comes up for a move the person closed.
// Only ever stops a signature: a step already signed, or a move already on its way, carries on as it was.

let closedAt = 0;

/** A money sheet was closed (not after a move went): what it started and hasn't signed yet stops. */
export function moneyClosed(at: number = Date.now()): void {
  closedAt = Math.max(closedAt, at);
}

/** A money sheet was closed at or after `startedAt` (when a move began getting ready). */
export function closedSince(startedAt: number): boolean {
  return closedAt >= startedAt;
}
