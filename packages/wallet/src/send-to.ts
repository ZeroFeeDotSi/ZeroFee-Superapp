// Home's Send (the Home plan §1.3, D124, D128): where a Send can land, and what it lands as. Every Send goes privately
// through NEAR (the core's own 1Click quotes, confidential on the NEAR side); the coin is changed on the way when the
// chains differ. Each destination chain's own coin, as 1Click lists it (GET /v0/tokens, catalogue-snapshot.ts, 2 Nov):
// a Send lands as that coin, so nothing arrives that the person can't spend or move on. One table for the sheet's line
// ("Lands as SOL on Solana.", "Lands as ETH (RH).") and the engine's leg 2 (ledger.hiddenFromRow, ledger.sendFromSafe).

/** The chains a Send reaches. BNB Chain is a destination only (its own wallet stays shut until its $1 test, D127). */
export type SendToChain = "sol" | "hood" | "eth" | "base" | "bsc" | "near" | "arb" | "op" | "pol" | "avax" | "gnosis" | "bera" | "btc" | "ltc" | "doge" | "zec" | "tron" | "sui" | "aptos";

/** `named`: how a person reads what lands, said alone: a coin whose name already says its network (D124: "ETH (RH)",
 *  never "on Robinhood Chain"), and NEAR as it arrives (never "wNEAR on NEAR"). */
export const LANDS_AS: Record<SendToChain, { tokenId: string; coin: string; network: string; named?: string }> = {
  sol: { tokenId: "nep141:sol.omft.near", coin: "SOL", network: "Solana" },
  hood: { tokenId: "nep141:hood.omft.near", coin: "ETH", network: "Robinhood Chain", named: "Robinhood" },
  eth: { tokenId: "nep141:eth.omft.near", coin: "ETH", network: "Ethereum" },
  base: { tokenId: "nep141:base.omft.near", coin: "ETH", network: "Base" },
  bsc: { tokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", coin: "BNB", network: "BNB Chain" },
  // a NEAR account paid on NEAR (DESTINATION_CHAIN): 1Click lists wNEAR there as "near:mainnet:native" (its own token
  // list, catalogue-snapshot.ts) and delivers it to a NEAR address as native NEAR (proven on mainnet 1–2 Nov, core
  // fund-start.ts), so the line says NEAR (the copy review's pair walk, 5 Nov: "NEAR (wrapped)" wasn't what lands). QA's
  // dust lap re-proves it on the private Send's leg. A NEAR Intents balance is paid as wNEAR: send-reach INTENTS_LINE.
  near: { tokenId: "nep141:wrap.near", coin: "wNEAR", network: "NEAR", named: "NEAR" },
  // Send S3 (the Send review, 5 Nov: "any chain 1Click supports"): each chain's own coin as 1Click lists it (the catalogue,
  // 2 Nov), on a chain whose address is checked before anything is signed (addresses.ts) and needs no memo. Left out:
  // XRP, Stellar and TON (an exchange's address there needs a memo; a new account needs a reserve), Bitcoin Cash
  // (its cash address's checksum isn't checked here), Cardano, Dash and the newer EVM chains: Send names them, once.
  arb: { tokenId: "nep141:arb.omft.near", coin: "ETH", network: "Arbitrum" },
  op: { tokenId: "nep245:v2_1.omni.hot.tg:10_11111111111111111111", coin: "ETH", network: "Optimism" },
  pol: { tokenId: "nep245:v2_1.omni.hot.tg:137_11111111111111111111", coin: "POL", network: "Polygon" },
  avax: { tokenId: "nep245:v2_1.omni.hot.tg:43114_11111111111111111111", coin: "AVAX", network: "Avalanche" },
  gnosis: { tokenId: "nep141:gnosis.omft.near", coin: "xDAI", network: "Gnosis" },
  bera: { tokenId: "nep141:bera.omft.near", coin: "BERA", network: "Berachain" },
  btc: { tokenId: "nep141:btc.omft.near", coin: "BTC", network: "Bitcoin" },
  ltc: { tokenId: "nep141:ltc.omft.near", coin: "LTC", network: "Litecoin" },
  doge: { tokenId: "nep141:doge.omft.near", coin: "DOGE", network: "Dogecoin" },
  zec: { tokenId: "nep141:zec.omft.near", coin: "ZEC", network: "Zcash" },
  tron: { tokenId: "nep141:tron.omft.near", coin: "TRX", network: "Tron" },
  sui: { tokenId: "nep141:sui.omft.near", coin: "SUI", network: "Sui" },
  aptos: { tokenId: "nep141:aptos.omft.near", coin: "APT", network: "Aptos" },
};

/**
 * What a Send to a NEAR account lands as (the Send rule, 5 Nov: every currency goes in its own coin): a coin the Safe
 * holds on NEAR itself (USDC on NEAR, any NEP-141 there) lands as that same coin, exact; anything else (NEAR, a wallet's
 * SOL or ETH, a coin from another chain) lands as NEAR, as before.
 */
export function nearLandsAs(s: { row: string | null; chain?: string; tokenId: string; symbol: string } | null | undefined): { tokenId: string; coin: string } {
  const own = s && s.row === null && s.chain === "near" && s.tokenId.startsWith("nep141:") && s.tokenId !== LANDS_AS.near.tokenId;
  return own ? { tokenId: s.tokenId, coin: s.symbol } : { tokenId: LANDS_AS.near.tokenId, coin: LANDS_AS.near.named! };
}

/** A payout to a NEAR account NEAR Intents didn't take (wallet-problems.ts nearPayoutClosed): the Send sheet says it with
 *  the wallet the money is still in (send-words.ts nearPayoutLine). */
export { NEAR_PAYOUT_CLOSED } from "./wallet-problems.ts";

export const isSendToChain = (c: string | null | undefined): c is SendToChain => typeof c === "string" && Object.hasOwn(LANDS_AS, c);

/** An EVM address could be on any of these: the person picks one ("Which network?"), never a guess. */
export const EVM_SEND_TO: readonly SendToChain[] = ["hood", "bsc", "eth", "base", "arb", "op", "pol", "avax", "gnosis", "bera"];
/** Every other chain Send reaches, read from the address's own shape and checksum (addresses.ts): Sui and Aptos share
 *  one shape (0x and 64 hex), so such an address asks which, as a 0x one does. */
export const OTHER_SEND_TO: readonly SendToChain[] = ["btc", "ltc", "doge", "zec", "tron", "sui", "aptos"];

/**
 * The quote relay's own limit on one 1Click quote (apps/quotes relay.mjs POCKET_USD, D132; a test holds them equal, so
 * the form never stops at a figure the relay no longer has: security review L6): a Send is at most this many dollars.
 * Named where it stops a Send, never a silent cap. A relay not yet redeployed still refuses over $100, and that is said
 * by name from its own answer (core services.ts RELAY_OLD_LIMIT). Hidden's own cap is gone from this path (D128).
 */
export const RELAY_SEND_MAX_USD = 10_000;
export const RELAY_LIMIT_LINE = `ZeroFee's price server takes up to $${RELAY_SEND_MAX_USD.toLocaleString("en-US")} a send.`;
