// ?demo's two sample coins nobody can sell back (demo-samples.ts), as data only, so the sample engine (demo-engine.ts)
// can refuse them at the quote as the real engines do (evm/aggregator.ts, evm/native.ts: the sell-back test reverts)
// without loading the sample chain.
import type { EvmChain } from "../evm/chains.ts";

export interface SampleCoin { chain: EvmChain; address: string; pool: string; dex: string; symbol: string; name: string; priceUsd: number }
export const SAMPLE_UNSELLABLE: Record<EvmChain, SampleCoin> = {
  bsc: { chain: "bsc", address: "0x5a3e00000000000000000000000000000000b5c1", pool: "0x5a3e0000000000000000000000000000000b5c01", dex: "pancakeswap-v3-bsc", symbol: "NOSELL", name: "Lucky Frog", priceUsd: 0.0042 },
  hood: { chain: "hood", address: "0x5a3e00000000000000000000000000000000400d", pool: "0x5a3e0000000000000000000000000000000400d1", dex: "uniswap-v3-robinhood", symbol: "NOSELL", name: "Lucky Frog", priceUsd: 0.0017 },
};
/** A ?demo coin no one can sell back. */
export const isSampleTrap = (chain: string, address: string): boolean => SAMPLE_UNSELLABLE[chain as EvmChain]?.address === address.toLowerCase();
