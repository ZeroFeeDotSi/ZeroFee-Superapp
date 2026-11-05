// Live check of the on-chain spot price (market/spot.ts) on GeckoTerminal's trending pools of each chain, read-only over
// the free nodes: the price read from each pool against GeckoTerminal's price of the same pool, and which layout read it.
// Nothing is signed or sent.
//
//   node packages/trade/tools/spot-live-check.ts [rows per chain, default 8]
import { GT_BASE, GT_NETWORK } from "../src/market/gt.ts";
import { poolViews } from "../src/market/map.ts";
import { createNativePrices } from "../src/market/price.ts";
import { createGt } from "../src/market/gt.ts";
import { spotPrice, type SpotPool } from "../src/market/spot.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { createEvmRpc } from "../src/evm/rpc.ts";
import type { ChainId } from "../src/types.ts";

const N = Number(process.argv[2] ?? 8);
const sol = createSolRpc();
const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
let calls = 0;
const rpc = (chain: ChainId, method: string, params: unknown[]) => { calls++; return chain === "sol" ? sol.call(method, params) : evm[chain].call(method, params); };
const gt = createGt({ fetch, now: Date.now, storage: null });
const nativeUsd = createNativePrices({ fetch, now: Date.now, gt });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("Read-only: each pool's price read on chain, against GeckoTerminal's price of the same pool.\n");
let n = 0, within5 = 0, none = 0;
const worst: number[] = [];
for (const chain of ["sol", "hood", "bsc"] as ChainId[]) {
  const j = await (await fetch(`${GT_BASE}/networks/${GT_NETWORK[chain]}/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`, { headers: { accept: "application/json" } })).json();
  for (const v of poolViews(chain, j).slice(0, N)) {
    const pool: SpotPool = { chain, pool: v.pool, dex: v.dex, coin: { address: v.coin.address, ...(v.coin.decimals !== undefined ? { decimals: v.coin.decimals } : {}) }, quote: { address: v.quote.address, ...(v.quote.kind ? { kind: v.quote.kind } : {}), ...(v.quote.decimals !== undefined ? { decimals: v.quote.decimals } : {}), ...(v.quote.priceUsd ? { priceUsd: v.quote.priceUsd } : {}) } };
    const [t, c0] = [performance.now(), calls];
    const s = await spotPrice({ rpc, nativeUsd }, chain, v.coin.address, pool);
    n++;
    const r = s ? s.priceUsd / v.coin.priceUsd : undefined;
    if (r === undefined) none++; else { worst.push(Math.abs(r - 1)); if (Math.abs(r - 1) <= 0.05) within5++; }
    console.log(`${chain.padEnd(4)} ${v.coin.symbol.slice(0, 10).padEnd(10)} ${v.dex.slice(0, 26).padEnd(26)} ${s ? `${s.source.padEnd(24)} ${r!.toFixed(3)}x GeckoTerminal` : "no spot (a pool type it doesn't read)".padEnd(40)}  ${(performance.now() - t).toFixed(0)} ms, ${calls - c0} calls`);
  }
  await sleep(2_500);
}
worst.sort((a, b) => b - a);
console.log(`\n${n} pools: ${n - none} priced on chain, ${within5} within 5 % of GeckoTerminal; ${none} not read; the farthest ${(worst[0] ?? 0) * 100 | 0}% off`);
