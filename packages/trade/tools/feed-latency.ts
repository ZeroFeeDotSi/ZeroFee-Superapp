// How fast a trade reaches our screen against how fast GeckoTerminal shows it (product decision, 28 Oct: "measure GT's own delay and
// ours"), read-only. For the top trending pools of each chain: our socket feed (market/live.ts over WS_HOSTS, polling behind
// it) and GeckoTerminal's public trades list (asked every 3 s) follow the same pool at once. For every swap both saw, its
// block's time (GeckoTerminal's block_timestamp, one second resolution: the true delays are about half a second lower) is
// subtracted from when each first had it. Reported per chain: median and p90 of ours and of GeckoTerminal's, and how many
// swaps. Nothing is signed or sent; the sockets only subscribe.
//
//   node packages/trade/tools/feed-latency.ts [pools per chain, default 2] [seconds per pool, default 90]
import { GT_BASE, GT_NETWORK } from "../src/market/gt.ts";
import { poolViews } from "../src/market/map.ts";
import { createGt } from "../src/market/gt.ts";
import { createNativePrices } from "../src/market/price.ts";
import { followSwaps, POLL_MS, type Tick } from "../src/market/live.ts";
import { allowedOrigin, closeAllSockets, type WsLike } from "../src/market/hub.ts";
import type { SpotPool } from "../src/market/spot.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { createEvmRpc } from "../src/evm/rpc.ts";
import type { ChainId } from "../src/types.ts";

const N = Number(process.argv[2] ?? 2), SECS = Number(process.argv[3] ?? 90), GT_EVERY_MS = 3_000;
const sol = createSolRpc();
const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
const rpc = (chain: ChainId, method: string, params: unknown[]) => (chain === "sol" ? sol.call(method, params) : evm[chain].call(method, params));
const gt = createGt({ fetch, now: Date.now, storage: null });
const nativeUsd = createNativePrices({ fetch, now: Date.now, gt });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]!; };
const fmt = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "-");
const ws = (url: string): WsLike => {
  if (!(["sol", "bsc", "hood"] as ChainId[]).some((c) => allowedOrigin(c, url))) throw new Error("not a live-feed host");
  return new (globalThis as unknown as { WebSocket: new (u: string) => WsLike }).WebSocket(url);
};
const sameTx = (a: string) => a.toLowerCase();

const totals: Record<string, { ours: number[]; gt: number[] }> = {};
console.log(`Read-only. Each pool: our socket feed and GeckoTerminal's trades list (every ${GT_EVERY_MS / 1000} s) for ${SECS} s.\n`);
for (const chain of ["sol", "bsc", "hood"] as ChainId[]) {
  totals[chain] = { ours: [], gt: [] };
  const j = await (await fetch(`${GT_BASE}/networks/${GT_NETWORK[chain]}/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`, { headers: { accept: "application/json" } })).json();
  for (const v of poolViews(chain, j).slice(0, N)) {
    const pool: SpotPool = { chain, pool: v.pool, dex: v.dex, coin: { address: v.coin.address, ...(v.coin.decimals !== undefined ? { decimals: v.coin.decimals } : {}) }, quote: { address: v.quote.address, ...(v.quote.kind ? { kind: v.quote.kind } : {}), ...(v.quote.decimals !== undefined ? { decimals: v.quote.decimals } : {}), ...(v.quote.priceUsd ? { priceUsd: v.quote.priceUsd } : {}) } };
    const ours = new Map<string, number>(), gtSeen = new Map<string, number>(), blockAt = new Map<string, number>();
    const stop = followSwaps({ rpc, nativeUsd }, chain, v.coin.address, pool, (x: Tick) => { if (x.tx && !ours.has(sameTx(x.tx))) ours.set(sameTx(x.tx), Date.now()); }, { pollMs: POLL_MS[chain], ws });
    let first = true;
    const started = Date.now(), end = started + SECS * 1000;
    while (Date.now() < end) {
      const at = Date.now();
      const r = await fetch(`${GT_BASE}/networks/${GT_NETWORK[chain]}/pools/${v.pool}/trades`, { headers: { accept: "application/json" } }).then((x) => (x.ok ? x.json() : null), () => null) as { data?: { attributes?: { tx_hash?: string; block_timestamp?: string } }[] } | null;
      for (const t of r?.data ?? []) {
        const h = t.attributes?.tx_hash, bt = Date.parse(t.attributes?.block_timestamp ?? "");
        if (!h || !Number.isFinite(bt)) continue;
        blockAt.set(sameTx(h), bt);
        // what GeckoTerminal listed before we started isn't a delay we saw: only swaps new since the first read count
        if (!first && !gtSeen.has(sameTx(h))) gtSeen.set(sameTx(h), at);
        if (first) gtSeen.set(sameTx(h), NaN);
      }
      first = false;
      await sleep(Math.max(0, GT_EVERY_MS - (Date.now() - at)));
    }
    stop();
    const oursLag: number[] = [], gtLag: number[] = [];
    for (const [h, bt] of blockAt) {
      // only swaps made while we watched: GeckoTerminal also lists older ones late (its back-fill), which isn't the delay
      // a person sees on a live coin
      if (bt < started) continue;
      const o = ours.get(h), g = gtSeen.get(h);
      if (o !== undefined && o >= bt - 2_000) oursLag.push(o - bt);
      if (g !== undefined && Number.isFinite(g)) gtLag.push(g - bt);
    }
    totals[chain]!.ours.push(...oursLag); totals[chain]!.gt.push(...gtLag);
    console.log(`${chain.padEnd(4)} ${v.coin.symbol.slice(0, 10).padEnd(10)} ${v.dex.slice(0, 20).padEnd(20)} ours: median ${fmt(pct(oursLag, 0.5))} p90 ${fmt(pct(oursLag, 0.9))} (${oursLag.length})   GeckoTerminal: median ${fmt(pct(gtLag, 0.5))} p90 ${fmt(pct(gtLag, 0.9))} (${gtLag.length})`);
    await sleep(6_000);
  }
}
closeAllSockets();
console.log("\nper chain (after the block):");
for (const [c, t] of Object.entries(totals)) console.log(`  ${c.padEnd(4)} ours median ${fmt(pct(t.ours, 0.5))} p90 ${fmt(pct(t.ours, 0.9))} (${t.ours.length} swaps) · GeckoTerminal median ${fmt(pct(t.gt, 0.5))} p90 ${fmt(pct(t.gt, 0.9))} (${t.gt.length})`);
process.exit(0);
