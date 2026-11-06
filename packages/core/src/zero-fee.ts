// Who is paid when money moves (product decision, 5 Nov). Every money sheet (Add,
// Send, Swap, Move, a trade) says, in one quiet block right above its button, the figure first, who gets the fee, directly: NEAR Intents (1Click's
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
 * the copy review's fee-line ruling (5 Nov): the figure line is "Fees · about $0.13", the quote's own figure, and the quiet line that goes with
 * it is FEES_KEPT; it replaces any other zero-fee line there, never two. With no figure on screen, who is paid alone (intentsPaid).
 */
export function feesFigure(usd: number | null | undefined): string | null {
  const f = feeFigure(usd);
  return f === null ? null : `Fees · ${f}`;
}
export const FEES_KEPT = `NEAR Intents and the network keep this. ${ZERO_FEE}`;

/** A move through NEAR Intents (Home's Swap, Move and Send; its price is 1Click's, its fee is in that price), no figure on screen. */
export const intentsPaid = (): string => `Any fee goes to NEAR Intents and the network. ${ZERO_FEE}`;
/** The quiet line above a NEAR Intents move's button: "this" only where a figure is on screen. */
export const intentsKept = (figureShown: boolean): string => (figureShown ? FEES_KEPT : intentsPaid());

/**
 * Routers pick pools and add no fee of their own on this path: Jupiter's platform_fee_bps is pinned to 0 (core sol/payout.ts), and
 * KyberSwap's feeAmount and feeReceiver are never set (trade evm/kyber.ts). So the fee in the price is the pools', never the router's.
 */
const ROUTERS = new Set(["Jupiter", "KyberSwap"]);
const inPrice = (exchange: string): string => {
  const names = exchange.split(" and ");
  const routers = names.filter((n) => ROUTERS.has(n));
  if (!routers.length) return exchange.includes(" and ") ? `${exchange}'s fees are in the price.` : `${exchange}'s fee is in the price.`;
  const venues = names.filter((n) => !ROUTERS.has(n));
  const pools = `pools ${routers.join(" and ")} picks`;
  return venues.length ? `${venues.join(" and ")} and the ${pools} keep a fee, in the price.` : `The ${pools} keep a fee, in the price.`;
};

/**
 * A trade on an exchange (Rhea on NEAR, pump.fun on Solana, Uniswap…): the exchange's own fee is in its price, the network's fee
 * is the quote's own figure. "pump.fun's fee is in the price. Solana's network gets about $0.01. ZeroFee takes nothing." Through
 * a router: "The pools Jupiter picks keep a fee, in the price. ..." No exchange named: the network alone.
 */
export function tradePaid(exchange: string | null | undefined, network: string, networkFeeUsd?: number | null): string {
  const f = networkFeeUsd && networkFeeUsd > 0 ? feeFigure(networkFeeUsd) : null; // a network always takes one: 0 is unknown
  const who = exchange ? `${inPrice(exchange)} ` : "";
  return `${who}${f === null ? `${network} gets its own network fee.` : `${network}'s network gets ${f}.`} ${ZERO_FEE}`;
}

/** A plain send or add on one chain (the web wallet's): only the chain's own network fee. */
export const networkPaid = (network: string, feeUsd?: number | null): string => tradePaid(null, network, feeUsd);
/** Receiving on one chain: the sender pays its network. */
export const receivePaid = (network: string): string => `The sender pays ${network}'s network fee. ${ZERO_FEE}`;
