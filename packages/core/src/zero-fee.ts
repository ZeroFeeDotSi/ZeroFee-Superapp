// Who is paid when money moves (product decision, 5 Nov). Every money sheet (Add,
// Send, Swap, Move, a trade) says, in one quiet line under its button, who gets the fee, directly: NEAR Intents (1Click's
// prices, its bridge), the exchange a trade runs on (Rhea, Jupiter, pump.fun…), or the chain's own network fee; then that
// ZeroFee takes nothing. Real figures only: the quote's own fee, or none (never a made-up one). The one source of these
// words, so no screen can say ZeroFee takes a cut (zero-fee.test.ts reads them all).

export const ZERO_FEE = "ZeroFee takes nothing.";

/** A fee in dollars as the line says it: "about $0.13"; "under a cent" below half a cent; null when it isn't known. */
export function feeFigure(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined || !Number.isFinite(usd) || usd < 0) return null;
  return usd < 0.005 ? "under a cent" : `about $${usd.toFixed(2)}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const usdWords = (x: number) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;

/**
 * A move through NEAR Intents (Home's Swap, Move and Send; its price is 1Click's, its fee is in that price): "About
 * $0.13 of your $3 goes to NEAR Intents and the network. ZeroFee takes nothing." With no figure yet: who is paid alone.
 */
export function intentsPaid(feeUsd?: number | null, ofUsd?: number | null): string {
  const f = feeFigure(feeUsd);
  if (f === null) return `Any fee goes to NEAR Intents and the network. ${ZERO_FEE}`;
  const of = ofUsd && ofUsd > 0 && f !== "under a cent" ? ` of your ${usdWords(ofUsd)}` : "";
  return `${cap(f)}${of} goes to NEAR Intents and the network. ${ZERO_FEE}`;
}

/** Add money from another chain (a one-time address of NEAR Intents' bridge): its fee comes out of what arrives. */
export const ADD_PAID = `NEAR Intents' bridge moves your money in and keeps its own fee. ${ZERO_FEE}`;

/**
 * A trade on an exchange (Rhea on NEAR, Jupiter or pump.fun on Solana, Uniswap…): the exchange's own fee is in its price,
 * the network's fee is the quote's own figure. "Jupiter's fee is in the price. Solana's network gets about $0.01. ZeroFee takes
 * nothing." No exchange named: the network alone.
 */
export function tradePaid(exchange: string | null | undefined, network: string, networkFeeUsd?: number | null): string {
  const f = networkFeeUsd && networkFeeUsd > 0 ? feeFigure(networkFeeUsd) : null; // a network always takes one: 0 is unknown
  const who = !exchange ? "" : exchange.includes(" and ") ? `${exchange}'s fees are in the price. ` : `${exchange}'s fee is in the price. `;
  return `${who}${f === null ? `${network} gets its own network fee.` : `${network}'s network gets ${f}.`} ${ZERO_FEE}`;
}

/** A plain send or add on one chain (the web wallet's): only the chain's own network fee. */
export const networkPaid = (network: string, feeUsd?: number | null): string => tradePaid(null, network, feeUsd);
/** Receiving on one chain: the sender pays its network. */
export const receivePaid = (network: string): string => `The sender pays ${network}'s network fee. ${ZERO_FEE}`;
