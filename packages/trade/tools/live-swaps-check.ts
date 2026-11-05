// Live check of a coin's swaps read from the chain (market/live.ts), read-only over the free nodes: for the top trending
// pools of each chain, the pool's recent swaps (how many, how long, the last one's price against GeckoTerminal's), then the
// polling follower for a while (the swaps it saw, the node calls it made). Nothing is signed or sent.
//
//   node packages/trade/tools/live-swaps-check.ts [pools per chain, default 2] [seconds to follow, default 20]
import { GT_BASE, GT_NETWORK, createGt } from "../src/market/gt.ts";
import { poolViews } from "../src/market/map.ts";
import { createNativePrices } from "../src/market/price.ts";
import { followSwaps, recentSwaps, type Tick } from "../src/market/live.ts";
import type { SpotPool } from "../src/market/spot.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { createEvmRpc } from "../src/evm/rpc.ts";
import type { ChainId } from "../src/types.ts";

const N = Number(process.argv[2] ?? 2), SECS = Number(process.argv[3] ?? 20);
const sol = createSolRpc();
const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
let calls = 0;
const rpc = (chain: ChainId, method: string, params: unknown[]) => { calls++; return chain === "sol" ? sol.call(method, params) : evm[chain].call(method, params); };
const gt = createGt({ fetch, now: Date.now, storage: null });
const nativeUsd = createNativePrices({ fetch, now: Date.now, gt });
const env = { rpc, nativeUsd };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`Read-only. Recent swaps, then ${SECS} s of following each pool by polling (every 2 s).\n`);
for (const chain of ["sol", "hood", "bsc"] as ChainId[]) {
  const j = await (await fetch(`${GT_BASE}/networks/${GT_NETWORK[chain]}/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`, { headers: { accept: "application/json" } })).json();
  for (const v of poolViews(chain, j).slice(0, N)) {
    const pool: SpotPool = { chain, pool: v.pool, dex: v.dex, coin: { address: v.coin.address, ...(v.coin.decimals !== undefined ? { decimals: v.coin.decimals } : {}) }, quote: { address: v.quote.address, ...(v.quote.kind ? { kind: v.quote.kind } : {}), ...(v.quote.decimals !== undefined ? { decimals: v.quote.decimals } : {}), ...(v.quote.priceUsd ? { priceUsd: v.quote.priceUsd } : {}) } };
    let [t, c0] = [performance.now(), calls];
    const recent = await recentSwaps(env, chain, v.coin.address, pool, 30).catch((e) => { console.log(`  recent failed: ${(e as Error).message}`); return [] as Tick[]; });
    const last = recent.at(-1);
    console.log(`${chain.padEnd(4)} ${v.coin.symbol.slice(0, 10).padEnd(10)} ${v.dex.slice(0, 24).padEnd(24)} recent: ${String(recent.length).padStart(2)} swaps in ${(performance.now() - t).toFixed(0)} ms (${calls - c0} calls)` +
      (last ? `, the last ${Math.round((Date.now() - last.t) / 1000)} s ago at ${(last.priceUsd / v.coin.priceUsd).toFixed(3)}x GeckoTerminal's price` : ""));
    [t, c0] = [performance.now(), calls];
    const seen: Tick[] = [];
    const stop = followSwaps(env, chain, v.coin.address, pool, (x) => seen.push(x), { pollMs: 2_000 });
    await sleep(SECS * 1000);
    stop();
    const prices = seen.map((x) => x.priceUsd / v.coin.priceUsd);
    console.log(`     followed ${SECS} s: ${seen.length} new swaps, ${calls - c0} node calls` + (prices.length ? `, prices ${Math.min(...prices).toFixed(3)}-${Math.max(...prices).toFixed(3)}x GeckoTerminal's` : ""));
  }
  await sleep(2_500);
}
