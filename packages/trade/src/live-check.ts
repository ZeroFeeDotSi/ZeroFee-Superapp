// Can an unconfirmed trade be looked at again while its card is on screen (service.ts, the live re-check, RECHECK_MS)?
// Its words depend on it (job-cards.ts): "ZeroFee keeps checking." only when it is; else "Open this again to check."
import type { TradeRecord } from "./service.ts";

/** the audit's SHOULD (7 Nov): after this long from its send the live look slows to RECHECK_SLOW_MS (service.ts)... */
export const BACKOFF_AFTER_MS = 5 * 60_000;
/** ...and after this long it stops: the card then says "Open this again to check." (the next open still looks). */
export const LIVE_MAX_MS = 60 * 60_000;
/** How long ago this trade was sent (its tap when no send is kept). */
export const ageOf = (r: Pick<TradeRecord, "sentAt" | "startedAt">, now: number): number => now - (r.sentAt ?? r.startedAt);

/**
 * Sent within LIVE_MAX_MS, and a buy, sale or move back with its hashes and steps (Solana: its last valid height, the proof's bound), or a NEAR coin's
 * trade with its quote (the core's move id). Otherwise it is only looked at on the next open.
 */
export function liveCheckable(r: Pick<TradeRecord, "kind" | "chain" | "hashes" | "steps" | "quote" | "sentAt" | "startedAt">, now: number): boolean {
  return ageOf(r, now) <= LIVE_MAX_MS && checkableShape(r);
}
/** The record's shape alone allows a live look (its age aside). */
export function checkableShape(r: Pick<TradeRecord, "kind" | "chain" | "hashes" | "steps" | "quote">): boolean {
  if (r.kind === "fund") return false;
  if (r.chain === "near") return !!r.quote;
  const last = r.steps?.at(-1);
  if (!last || !r.hashes.length || r.hashes.length < r.steps!.length) return false;
  return r.chain !== "sol" || last.lastValidBlockHeight !== undefined;
}
