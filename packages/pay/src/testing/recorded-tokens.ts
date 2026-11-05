// Part of 1Click's token list (GET https://1click.chaindefuser.com/v0/tokens), recorded 2026-10-25T05:53:30Z: USDC, USDT,
// each chain's own coin, EURe and GBPe. A module rather than JSON, so the web demo's MockBridge can serve it as
// ledger.tokens too, and sample payment codes resolve to real coins.
import type { Token } from "@zerofee/wallet/types.ts";
import { fromOneClick } from "../tokens.ts";

export const RECORDED_AT_ISO = "2026-10-25T05:53:30Z";

const ROWS = [
  { assetId: "nep141:wrap.near", blockchain: "near", symbol: "wNEAR", decimals: 24, contractAddress: "wrap.near", price: 4.43 },
  { assetId: "nep141:eth.bridge.near", blockchain: "near", symbol: "ETH", decimals: 18, contractAddress: "eth.bridge.near", price: 2347.51 },
  { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", blockchain: "near", symbol: "USDC", decimals: 6, contractAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", price: 0.999545 },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", blockchain: "eth", symbol: "USDT", decimals: 6, contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7", price: 0.999043 },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", blockchain: "eth", symbol: "USDC", decimals: 6, contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", price: 0.999545 },
  { assetId: "nep141:eth.omft.near", blockchain: "eth", symbol: "ETH", decimals: 18, price: 2347.51 },
  { assetId: "nep141:btc.omft.near", blockchain: "btc", symbol: "BTC", decimals: 8, price: 80456 },
  { assetId: "nep141:nbtc.bridge.near", blockchain: "near", symbol: "BTC", decimals: 8, contractAddress: "nbtc.bridge.near", price: 80456 },
  { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL", decimals: 9, price: 101.75 },
  { assetId: "nep141:xrp.omft.near", blockchain: "xrp", symbol: "XRP", decimals: 6, price: 1.3 },
  { assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", blockchain: "bsc", symbol: "BNB", decimals: 18, price: 743.09 },
  { assetId: "nep245:v2_1.omni.hot.tg:137_11111111111111111111", blockchain: "pol", symbol: "POL", decimals: 18, price: 0.088982 },
  { assetId: "nep141:tron.omft.near", blockchain: "tron", symbol: "TRX", decimals: 6, price: 0.328427 },
  { assetId: "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz", blockchain: "stellar", symbol: "XLM", decimals: 7, price: 0.170201 },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", blockchain: "tron", symbol: "USDT", decimals: 6, contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", price: 0.999043 },
  { assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", blockchain: "sol", symbol: "USDT", decimals: 6, contractAddress: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", price: 0.999043 },
  { assetId: "nep141:usdt.tether-token.near", blockchain: "near", symbol: "USDT", decimals: 6, contractAddress: "usdt.tether-token.near", price: 0.999043 },
  { assetId: "nep141:arb.omft.near", blockchain: "arb", symbol: "ETH", decimals: 18, price: 2347.51 },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", blockchain: "arb", symbol: "USDC", decimals: 6, contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", price: 0.999545 },
  { assetId: "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", blockchain: "arb", symbol: "USDT0", decimals: 6, contractAddress: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", price: 0.998986 },
  { assetId: "nep141:base.omft.near", blockchain: "base", symbol: "ETH", decimals: 18, price: 2347.51 },
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", blockchain: "base", symbol: "USDC", decimals: 6, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", price: 0.999545 },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", blockchain: "sol", symbol: "USDC", decimals: 6, contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", price: 0.999545 },
  { assetId: "nep141:gnosis.omft.near", blockchain: "gnosis", symbol: "xDAI", decimals: 18, price: 1 },
  { assetId: "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near", blockchain: "gnosis", symbol: "USDC", decimals: 6, contractAddress: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", price: 0.999545 },
  { assetId: "nep141:gnosis-0x4ecaba5870353805a9f068101a40e0f32ed605c6.omft.near", blockchain: "gnosis", symbol: "USDT", decimals: 6, contractAddress: "0x4ecaba5870353805a9f068101a40e0f32ed605c6", price: 0.999043 },
  { assetId: "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L", blockchain: "pol", symbol: "USDC", decimals: 6, contractAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", price: 0.999545 },
  { assetId: "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr", blockchain: "pol", symbol: "USDT", decimals: 6, contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", price: 0.999043 },
  { assetId: "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", blockchain: "bsc", symbol: "USDC", decimals: 18, contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", price: 0.999545 },
  { assetId: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", blockchain: "bsc", symbol: "USDT", decimals: 18, contractAddress: "0x55d398326f99059ff775485246999027b3197955", price: 0.999043 },
  { assetId: "nep245:v2_1.omni.hot.tg:10_11111111111111111111", blockchain: "op", symbol: "ETH", decimals: 18, price: 2347.51 },
  { assetId: "nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo", blockchain: "op", symbol: "USDT", decimals: 6, contractAddress: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", price: 0.999043 },
  { assetId: "nep245:v2_1.omni.hot.tg:10_2R1RXDBxCyJTeMEsdXydh7xsHmz", blockchain: "op", symbol: "USDT0", decimals: 6, contractAddress: "0x01bff41798a0bcf287b996046ca68b395dbc1071", price: 0.998986 },
  { assetId: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ", blockchain: "op", symbol: "USDC", decimals: 6, contractAddress: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", price: 0.999545 },
  { assetId: "nep245:v2_1.omni.hot.tg:1117_3tsdfyziyc7EJbP2aULWSKU4toBaAcN4FdTgfm5W1mC4ouR", blockchain: "ton", symbol: "USDT", decimals: 6, contractAddress: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", price: 0.999043 },
  { assetId: "nep245:v2_1.omni.hot.tg:1100_111bzQBB65GxAPAVoxqmMcgYo5oS3txhqs1Uh1cgahKQUeTUq1TJu", blockchain: "stellar", symbol: "USDC", decimals: 7, contractAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", price: 0.999545 },
  { assetId: "nep141:gnosis-0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430.omft.near", blockchain: "gnosis", symbol: "EURe", decimals: 18, contractAddress: "0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430", price: 1.12 },
  { assetId: "nep141:gnosis-0x5cb9073902f2035222b9749f8fb0c9bfe5527108.omft.near", blockchain: "gnosis", symbol: "GBPe", decimals: 18, contractAddress: "0x5cb9073902f2035222b9749f8fb0c9bfe5527108", price: 1.34 },
  { assetId: "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG", blockchain: "sol", symbol: "wNEAR", decimals: 9, contractAddress: "3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG", price: 4.43 },
];

export const RECORDED_TOKENS: Token[] = fromOneClick(ROWS);
