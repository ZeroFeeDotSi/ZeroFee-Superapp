// A Send of a wallet's TOKEN (the Send review, 5 Nov: "all the currencies the person holds"): the token itself goes into NEAR
// Confidential by the core's own 1Click quote (leg 1, subwallets.hiddenFromRow with `coin`), then on to the payee (leg 2),
// as the wallet's own coin does. The core never takes a mint or a contract from an app: each coin here is pinned, as 1Click
// lists it (GET /v0/tokens, catalogue-snapshot.ts, 2 Nov) and as the chain has it (Solana: the mint's owner program and
// decimals read from publicnode with getMultipleAccounts, 5 Nov; every one is the classic Token program). A coin not here
// can't go privately from a wallet, and Send says so with its one way on (Swap). Token-2022 coins (sUSDC) are left out: a
// mint there may carry a transfer fee or hook, so what arrives could be less than 1Click's quote was signed for.
// No imports: Send's sheet reads this table too (its own chunk), so the transactions are built in hidden-tx.ts.

export interface HiddenCoin {
  chain: "sol" | "hood";
  /** Solana: the mint; Robinhood Chain: the ERC-20's contract, lower case. */
  address: string;
  decimals: number;
  symbol: string;
}

const sol = (address: string, decimals: number, symbol: string): HiddenCoin => ({ chain: "sol", address, decimals, symbol });
const hood = (address: string, decimals: number, symbol: string): HiddenCoin => ({ chain: "hood", address, decimals, symbol });

/** 1Click's asset id → the coin on its own chain. Only `nep141:<chain>-….omft.near` ids, which privateQuoteIn takes. */
export const HIDDEN_COINS: Readonly<Record<string, HiddenCoin>> = Object.freeze({
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": sol("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6, "USDC"),
  "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": sol("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6, "USDT"),
  "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near": sol("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", 6, "$WIF"),
  "nep141:sol-57d087fd8c460f612f8701f5499ad8b2eec5ab68.omft.near": sol("ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", 6, "BOME"),
  "nep141:sol-c58e6539c2f2e097c251f8edf11f9c03e581f8d4.omft.near": sol("6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", 6, "TRUMP"),
  "nep141:sol-91914f13d3b54f8126a2824d71632d4b078d7403.omft.near": sol("CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn", 8, "xBTC"),
  "nep141:sol-df27d7abcc1c656d4ac3b1399bbfbba1994e6d8c.omft.near": sol("2Dyzu65QA9zdX1UeE7Gx71k7fiwyUK6sZdrvJ7auq5wm", 8, "TURBO"),
  "nep141:sol-1f00bb36e75cfc8e1274c1507cc3054f5b3f3ce1.omft.near": sol("AXCp86262ZPfpcV9bmtmtnzmJSL5sD99mCVJD4GR9vS", 9, "PUBLIC"),
  "nep141:sol-c634d063ceff771aff0c972ec396fd915a6bbd0e.omft.near": sol("J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr", 8, "SPX"),
  "nep141:sol-d600e625449a4d9380eaf5e3265e54c90d34e260.omft.near": sol("FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P", 6, "MELANIA"),
  "nep141:sol-bb27241c87aa401cc963c360c175dd7ca7035873.omft.near": sol("EJZJpNa4tDZ3kYdcRZgaAtaKm3fLJ5akmyPkCaKmfWvd", 6, "LOUD"),
  "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near": hood("0x5fc5360d0400a0fd4f2af552add042d716f1d168", 6, "USDG"),
  "nep141:hood-0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34.omft.near": hood("0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", 18, "USDe"),
  "nep141:hood-0x0bd7d308f8e1639fab988df18a8011f41eacad73.omft.near": hood("0x0bd7d308f8e1639fab988df18a8011f41eacad73", 18, "WETH"),
  "nep141:hood-0x39dbed3a2bd333467115de45665cc57f813c4571.omft.near": hood("0x39dbed3a2bd333467115de45665cc57f813c4571", 18, "PONS"),
  "nep141:hood-0x020bfc650a365f8bb26819deaabf3e21291018b4.omft.near": hood("0x020bfc650a365f8bb26819deaabf3e21291018b4", 18, "CASHCAT"),
});

/** The pinned coin for this 1Click id on this chain, or null. */
export function hiddenCoin(id: unknown, chain: unknown): HiddenCoin | null {
  if (typeof id !== "string" || !Object.hasOwn(HIDDEN_COINS, id)) return null;
  const c = HIDDEN_COINS[id]!;
  return c.chain === chain ? c : null;
}

/** The rent a new token account holds on Solana (165 bytes, rent-exempt): leg 1 makes 1Click's address its account. */
export const SOL_TOKEN_ACCOUNT_RENT = 2_039_280n;
