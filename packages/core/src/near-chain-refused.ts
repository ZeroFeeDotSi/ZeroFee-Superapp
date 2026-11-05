// QA's laps (5 Nov): a private Send to a NEAR account landed once, then 5 of 5 were refused (relay 400
// quotes.upstream.refused), and Swap's Safe NEAR → Safe USDC was refused at its price twice, both said as "1Click gave no
// price" / "1Click said no". 1Click's own answer to those shapes, read with dry quotes the same day (5 Nov
// UTC): "Quoting for this pair is not available" for every quote that takes a coin in from the NEAR chain itself
// (ORIGIN_CHAIN with a NEAR coin: wNEAR, NEAR's USDC) or pays one out on it (DESTINATION_CHAIN to a NEAR account), from
// any coin; a coin in from Solana and every move inside NEAR Intents quoted. The relay passes only 1Click's status class
// (never its text), so this is read from the quote's own shape. Said by NEAR Intents' name (voice: never "1Click").

/** A coin on the NEAR chain itself (NEP-141 on NEAR), not one NEAR Intents carries for another chain (*.omft.near). */
export const nearChainCoin = (id: unknown): boolean => typeof id === "string" && id.startsWith("nep141:") && !id.endsWith(".omft.near");

/** The quote takes a coin in from NEAR's own chain, or pays one out there. */
export function touchesNearChain(b: { depositType?: unknown; originAsset?: unknown; recipientType?: unknown; destinationAsset?: unknown }): boolean {
  return (b.depositType === "ORIGIN_CHAIN" && nearChainCoin(b.originAsset)) || (b.recipientType === "DESTINATION_CHAIN" && nearChainCoin(b.destinationAsset));
}

/** 1Click didn't take the request, as the quote relay says it (apps/quotes relay.mjs). */
export const upstreamRefused = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === "quotes.upstream.refused";

const dollars = (usd: number): string => `$${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`;
/** Swap's line when a Safe coin's leg is refused (rule 8: who, nothing moved, where the money is, what to tap). the copy review's words. */
export const safeSwapRefused = (usd: number): string => `NEAR Intents said no to this swap, so nothing moved. The ${dollars(usd)} is still in your Safe. Try again in a few minutes.`;
/** The NEAR wallet's own coin into its cash, refused the same way. */
export const nearWalletRefused = (usd: number): string => `NEAR Intents said no to this move, so nothing moved. The ${dollars(usd)} is still in your NEAR wallet. Try again in a few minutes.`;
