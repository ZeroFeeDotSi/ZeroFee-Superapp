// A coin's own light (V1's buy page, rewritten). The coin's colour on screen comes from its logo itself, drawn again
// large and blurred behind it (CSS, .tp-glow img and .zf-halo): no pixels are read, so no image host is asked a second
// time and nothing fails on a host that doesn't allow reading (CoinGecko's images don't). What a page still needs as a
// colour value (the sparks of a fill, the soft wash under the blur) is the chain's own.
import type { ChainId } from "../types.ts";

/** Each chain's colour: Solana's violet, Robinhood Chain's green, BNB's gold, NEAR's grey (NEAR's mark is black and white). */
export const CHAIN_GLOW: Record<ChainId, string> = { sol: "rgb(153,69,255)", hood: "rgb(0,200,5)", bsc: "rgb(240,185,11)", near: "rgb(140,140,150)" };

/** The colour a coin's page glows in: its chain's (its logo, blurred, carries its own colour on top). */
export const coinGlow = (chain: ChainId): string => CHAIN_GLOW[chain];
