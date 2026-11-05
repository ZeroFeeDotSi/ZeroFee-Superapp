// The engines' own errors (every chain). `kind` is what the fallbacks branch on; trade-problems.ts turns each into a Problem for the
// screen. `message` is for tests and the "More" detail, never the main words.
export type TradeErrorKind =
  | "funds"        // not enough of the coin, or of SOL for the fee: nothing was sent
  | "unavailable"  // no route, the pool is too thin, the coin can't be traded right now
  | "unsellable"   // the coin couldn't be sold back, so it isn't offered
  | "node"         // a node answered badly or not at all: try again
  | "moved";       // the price moved past the slippage: quote again once
/** When one kind needs more than one screen: which one. */
/** `not-this-swap`: the built transaction isn't the quoted swap (a route's own bytes, refused before signing; audit SOL-4).
 *  `prices`: no checked price to size the trade in (audit MKT-1): nothing is sized, every path would say the same. */
export type TradeErrorReason = "wallet-empty" | "sol-low" | "coin-low" | "thin" | "freezable" | "unchecked" | "not-this-swap" | "prices" | "unpriced" | "unknown-app" | IssuerHold;
/** A Token-2022 power that lets a coin's issuer take or stop what a buyer holds (sol/codec.ts issuerHold): never bought. */
export type IssuerHold = "delegated" | "pausable" | "hooked" | "fee-raisable" | "fee-high";
/** Refusals every path would give the same way, so the router doesn't try the next one: money, and the issuer's powers. */
const FINAL_REASONS = new Set<TradeErrorReason>(["freezable", "delegated", "pausable", "hooked", "fee-raisable", "fee-high", "prices"]);
export const isFinalRefusal = (e: unknown): boolean => e instanceof TradeError && (e.kind === "funds" || (e.reason !== undefined && FINAL_REASONS.has(e.reason)));
export class TradeError extends Error {
  readonly kind: TradeErrorKind;
  readonly reason?: TradeErrorReason;
  constructor(kind: TradeErrorKind, message: string, reason?: TradeErrorReason) {
    super(message);
    this.name = "TradeError";
    this.kind = kind;
    if (reason) this.reason = reason;
  }
}

/** The plain reason for a failed simulation. 6001 / 0x1771 = SlippageToleranceExceeded; other programs say "slippage" in their logs. */
export function simProblem(err: unknown, logs?: string[]): TradeError {
  const s = JSON.stringify(err);
  if (/6001|0x1771|SlippageToleranceExceeded/.test(s) || (logs ?? []).some((l) => /Slippage|0x1771/i.test(l))) return new TradeError("moved", "The price moved");
  if (/InsufficientFunds|InsufficientLamports|0x1\b|"Custom":1\b/.test(s)) return new TradeError("funds", "Not enough SOL for this trade and its fee");
  return new TradeError("unavailable", "This coin can't be traded right now");
}
