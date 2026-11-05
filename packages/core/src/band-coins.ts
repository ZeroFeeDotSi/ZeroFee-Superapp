// The coins the Safe's protection bands measure in dollars (H01), and the ONE check every screen asks before it offers a
// Safe swap of a coin (product decision, 5 Nov). Kept apart from demo-core so a screen's chunk
// reads it without the core.
/**
 * H01 / SIMPLE-SUPERAPP §3.3 (L14): the coins a band lists besides NEAR, USDC and USDT, so a move of any of them is
 * measured in dollars instead of falling to the strictest band (a coin a band doesn't list never fits it). The contract
 * takes at most 32 coins a band (MAX_COINS, main and release 9): NEAR, USDC, USDT and these 29. Order: what the app
 * moves most. "near": wNEAR, NEAR's own form, at NEAR's checked price. "usd": a stablecoin, at $1 whatever a list says
 * (audit NF-09: a de-peg makes the band smaller in dollars, never larger). "market": 1Click's fresh price, written only
 * when there is one, and never below `floorUsd` (80 % of its price on 1 Nov 2026): the limits are signed with no sheet at
 * set-up, so one bad price in the public list (NF-09's attack) can make a coin's limit at most 1.25 times its dollars,
 * and a coin that has fallen since only gets a smaller limit in dollars (it waits sooner), never a larger one.
 * BNB is not listed: its route isn't proven (H04).
 */
export const BAND_COINS: readonly { id: string; decimals: number; kind: "near" | "usd" | "market"; floorUsd?: number }[] = [
  { id: "nep141:wrap.near", decimals: 24, kind: "near" },
  { id: "nep141:sol.omft.near", decimals: 9, kind: "market", floorUsd: 76 },
  { id: "nep141:eth.omft.near", decimals: 18, kind: "market", floorUsd: 1815 },
  { id: "nep141:base.omft.near", decimals: 18, kind: "market", floorUsd: 1815 },
  { id: "nep141:arb.omft.near", decimals: 18, kind: "market", floorUsd: 1815 },
  { id: "nep141:hood.omft.near", decimals: 18, kind: "market", floorUsd: 1815 },
  { id: "nep141:btc.omft.near", decimals: 8, kind: "market", floorUsd: 62000 },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", decimals: 6, kind: "usd" },
  { id: "nep141:zec.omft.near", decimals: 8, kind: "market", floorUsd: 995 },
  { id: "nep141:eth.bridge.near", decimals: 18, kind: "market", floorUsd: 1815 },
  { id: "nep141:nbtc.bridge.near", decimals: 8, kind: "market", floorUsd: 62000 },
  { id: "nep141:xrp.omft.near", decimals: 6, kind: "market", floorUsd: 1 },
  { id: "nep141:doge.omft.near", decimals: 8, kind: "market", floorUsd: 0.06 },
  { id: "nep141:tron.omft.near", decimals: 6, kind: "market", floorUsd: 0.25 },
  { id: "nep141:ltc.omft.near", decimals: 8, kind: "market", floorUsd: 44.7 },
  { id: "nep141:bch.omft.near", decimals: 8, kind: "market", floorUsd: 226 },
  { id: "nep141:cardano.omft.near", decimals: 6, kind: "market", floorUsd: 0.155 },
  { id: "nep141:sui.omft.near", decimals: 9, kind: "market", floorUsd: 0.72 },
  { id: "nep141:eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.omft.near", decimals: 8, kind: "market", floorUsd: 62000 },
  { id: "nep141:eth-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", decimals: 8, kind: "market", floorUsd: 62000 },
  { id: "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", decimals: 8, kind: "market", floorUsd: 62000 },
  { id: "nep141:sui-c1b81ecaf27933252d31a963bc5e9458f13c18ce.omft.near", decimals: 6, kind: "usd" },
];
/** The contract's MAX_COINS (contracts/account-policy, main and release 9). */
export const BAND_MAX_COINS = 32;

/** USDC and USDT inside NEAR Intents: every band lists them (beside NEAR) whatever BAND_COINS says. */
const ALWAYS_LISTED = ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:usdt.tether-token.near"];
const LISTED: ReadonlySet<string> = new Set([...ALWAYS_LISTED, ...BAND_COINS.map((c) => c.id)]);

/**
 * Can the Safe pay this intents coin out with Face ID today (a Sell, or a swap from it)? Today only a coin the bands list:
 * an unlisted one falls to the strictest band (contracts/account-policy level_for_moves: a day's wait), and the core
 * refuses a quote that would wait (security.quote.cant-wait). So it is also the check for a Buy: never buy what the Safe
 * can't sell. THE one switch: when the contract counts every coin under the dollar limit, this returns true for any coin.
 */
export function safeCanSell(assetId: string): boolean {
  return LISTED.has(assetId);
}
