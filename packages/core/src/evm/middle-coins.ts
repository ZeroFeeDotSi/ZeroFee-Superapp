// Gap 5 (coverage audit, the review's ruling 4 Nov): a trade may go through ONE middle coin, and only one of these:
// the chain's own dollar coins that coins are quoted in. A two-hop trade with no sheet also needs both pools from known
// factories (the UniversalRouter's own v3 factory and Uniswap v4's PoolManager, or the v2 router's own factory), the
// reference band end to end, the test run paying only this wallet, and the wallet's balance of the middle coin unchanged
// by it (evm.ts evmSessionRefusal, subwallets.ts tradeRefusal). The chain's wrapped native coin is the trade's own end,
// never a middle. Each address is read on two nodes (symbol and decimals the same on both), 4 Nov 2026.
import type { EvmChainName } from "./decode.ts";

export const MIDDLE_COINS: Readonly<Record<EvmChainName, Readonly<Record<string, string>>>> = Object.freeze({
  // USDG: 6 decimals, symbol "USDG" on rpc.mainnet.chain.robinhood.com and robinhood.drpc.org; the coin GeckoTerminal's
  // Robinhood Chain pools are quoted in ("PONS / USDG", $58.7M on Uniswap v4); its v3 pool with WETH at 0.01 % holds
  // 3,328 WETH and 2.82M USDG (factory 0x1f7d…2efa getPool)
  hood: Object.freeze({ "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG" }),
  // USDC (Binance-Peg): 18 decimals, symbol "USDC" on bsc-dataseed.bnbchain.org and bsc-rpc.publicnode.com
  bsc: Object.freeze({ "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC" }),
});

export const isMiddleCoin = (chain: EvmChainName, coin: string): boolean => Object.hasOwn(MIDDLE_COINS[chain], coin.toLowerCase());
