// D155 (product decision, 3 Nov; amends D115): set-up takes money from ANY chain NEAR Intents supports, each chain's own
// coin, into the person's own NEAR account through NEAR Confidential. These are the coins beyond Home's own Add chains
// (SOL, ETH (RH), BNB, NEAR: float-add.ts OUTSIDE_COIN), each as 1Click's token list names it (GET /v0/tokens, read
// 3 Nov: assetId, decimals, symbol; a native coin is one with no contract address), with the shape of 1Click's one-time
// deposit address there (the core refuses any other). Only chains whose deposit address needs no memo (review M1): XRP,
// Stellar and TON need one, so they aren't here. Set-up asks for each through the same one-time confidential address as
// an Add (the person's own confidential balance is the recipient and the refund: no wallet address is ever needed).

export interface SetupCoin {
  /** The chain's id, as 1Click's token list names it ("btc", "doge"…). */
  chain: string;
  tokenId: string;
  decimals: number;
  symbol: string;
  /** The coin's own name ("Bitcoin"), or the network's where its coin is ETH ("Base"). */
  name: string;
  /** The shape of 1Click's one-time deposit address on that chain. */
  address: RegExp;
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const HOT = (id: number) => `nep245:v2_1.omni.hot.tg:${id}_11111111111111111111`;

/** Each chain's own coin, beyond Home's Add chains, in no particular order (the page orders them). */
export const SETUP_COINS: readonly SetupCoin[] = [
  { chain: "btc", tokenId: "nep141:btc.omft.near", decimals: 8, symbol: "BTC", name: "Bitcoin", address: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/ },
  { chain: "eth", tokenId: "nep141:eth.omft.near", decimals: 18, symbol: "ETH", name: "Ethereum", address: EVM },
  { chain: "base", tokenId: "nep141:base.omft.near", decimals: 18, symbol: "ETH", name: "Base", address: EVM },
  { chain: "arb", tokenId: "nep141:arb.omft.near", decimals: 18, symbol: "ETH", name: "Arbitrum", address: EVM },
  // BNB Chain's coin (Home's Add has it too, shut until its test: float-add.ts OUTSIDE_COIN.bsc); set-up may take it
  { chain: "bsc", tokenId: HOT(56), decimals: 18, symbol: "BNB", name: "BNB Chain", address: EVM },
  { chain: "op", tokenId: HOT(10), decimals: 18, symbol: "ETH", name: "Optimism", address: EVM },
  { chain: "pol", tokenId: HOT(137), decimals: 18, symbol: "POL", name: "Polygon", address: EVM },
  { chain: "avax", tokenId: HOT(43114), decimals: 18, symbol: "AVAX", name: "Avalanche", address: EVM },
  { chain: "gnosis", tokenId: "nep141:gnosis.omft.near", decimals: 18, symbol: "xDAI", name: "Gnosis", address: EVM },
  { chain: "bera", tokenId: "nep141:bera.omft.near", decimals: 18, symbol: "BERA", name: "Berachain", address: EVM },
  { chain: "doge", tokenId: "nep141:doge.omft.near", decimals: 8, symbol: "DOGE", name: "Dogecoin", address: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/ },
  { chain: "ltc", tokenId: "nep141:ltc.omft.near", decimals: 8, symbol: "LTC", name: "Litecoin", address: /^(ltc1[02-9ac-hj-np-z]{11,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/ },
  { chain: "bch", tokenId: "nep141:bch.omft.near", decimals: 8, symbol: "BCH", name: "Bitcoin Cash", address: /^((bitcoincash:)?[qp][02-9ac-hj-np-z]{41}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/ },
  { chain: "zec", tokenId: "nep141:zec.omft.near", decimals: 8, symbol: "ZEC", name: "Zcash", address: /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/ },
  { chain: "dash", tokenId: "nep141:dash.omft.near", decimals: 8, symbol: "DASH", name: "Dash", address: /^X[1-9A-HJ-NP-Za-km-z]{33}$/ },
  { chain: "tron", tokenId: "nep141:tron.omft.near", decimals: 6, symbol: "TRX", name: "Tron", address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  { chain: "sui", tokenId: "nep141:sui.omft.near", decimals: 9, symbol: "SUI", name: "Sui", address: /^0x[0-9a-fA-F]{64}$/ },
  { chain: "aptos", tokenId: "nep141:aptos.omft.near", decimals: 8, symbol: "APT", name: "Aptos", address: /^0x[0-9a-fA-F]{1,64}$/ },
  { chain: "cardano", tokenId: "nep141:cardano.omft.near", decimals: 6, symbol: "ADA", name: "Cardano", address: /^addr1[02-9ac-hj-np-z]{50,120}$/ },
  { chain: "starknet", tokenId: "nep141:starknet.omft.near", decimals: 18, symbol: "STRK", name: "Starknet", address: /^0x[0-9a-fA-F]{1,64}$/ },
];

export const setupCoin = (chain: unknown): SetupCoin | undefined => SETUP_COINS.find((c) => c.chain === chain);
