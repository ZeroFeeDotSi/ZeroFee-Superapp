// Live check of the open coin's swaps over the chains' sockets (market/live.ts with hub.ts), read-only: for the top trending
// pools of each chain, the same pool followed twice at once, over the socket (WS_HOSTS only, polling behind it) and by
// polling alone, for a while. Reported: how soon the socket was live, how many swaps each saw, how much sooner the socket's
// arrived than the poll's, and the socket's delay after the block (the block's own time, one second resolution, so the true
// figure is about half a second lower). Nothing is signed or sent; the sockets only subscribe.
//
//   node packages/trade/tools/live-ws-check.ts [pools per chain, default 2] [seconds to follow, default 30]
import { GT_BASE, GT_NETWORK, createGt } from "../src/market/gt.ts";
import { poolViews } from "../src/market/map.ts";
import { createNativePrices } from "../src/market/price.ts";
import { followSwaps, POLL_MS, type Tick } from "../src/market/live.ts";
import { allowedOrigin, closeAllSockets, type WsLike } from "../src/market/hub.ts";
import type { FeedState } from "../src/market/feed.ts";
import type { SpotPool } from "../src/market/spot.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { createEvmRpc } from "../src/evm/rpc.ts";
import type { ChainId } from "../src/types.ts";

const N = Number(process.argv[2] ?? 2), SECS = Number(process.argv[3] ?? 30);
const sol = createSolRpc();
const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
const calls = { ws: 0, poll: 0 };
const rpcOf = (who: "ws" | "poll") => (chain: ChainId, method: string, params: unknown[]) => { calls[who]++; return chain === "sol" ? sol.call(method, params) : evm[chain].call(method, params); };
const gt = createGt({ fetch, now: Date.now, storage: null });
const nativeUsd = createNativePrices({ fetch, now: Date.now, gt });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const fmt = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "-");
const sockets: string[] = [];
// node's own WebSocket, on the hub's allowed hosts only (the app uses hub.ts's browserWs)
const ws = (url: string): WsLike => {
  if (!(["sol", "bsc", "hood"] as ChainId[]).some((c) => allowedOrigin(c, url))) throw new Error("not a live-feed host");
  sockets.push(url);
  return new (globalThis as unknown as { WebSocket: new (u: string) => WsLike }).WebSocket(url);
};

async function blockTimes(chain: ChainId, pool: string, txs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (chain === "sol") {
    const sigs = (await sol.call("getSignaturesForAddress", [pool, { limit: 100, commitment: "confirmed" }]).catch(() => [])) as { signature: string; blockTime?: number }[];
    for (const s of sigs) if (s.blockTime && txs.includes(s.signature)) out.set(s.signature, s.blockTime * 1000);
    return out;
  }
  for (const h of txs.slice(0, 8)) {
    try {
      const r = await evm[chain].call("eth_getTransactionReceipt", [h]);
      const b = await evm[chain].call("eth_getBlockByNumber", [r.blockNumber, false]);
      out.set(h, Number(BigInt(b.timestamp)) * 1000);
    } catch { /* a node that didn't answer: one sample fewer */ }
  }
  return out;
}

console.log(`Read-only. Each pool followed ${SECS} s over the socket and by polling (Solana every ${POLL_MS.sol / 1000} s, EVM every ${POLL_MS.bsc / 1000} s) at once.\n`);
for (const chain of ["sol", "hood", "bsc"] as ChainId[]) {
  const j = await (await fetch(`${GT_BASE}/networks/${GT_NETWORK[chain]}/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`, { headers: { accept: "application/json" } })).json();
  for (const v of poolViews(chain, j).slice(0, N)) {
    const pool: SpotPool = { chain, pool: v.pool, dex: v.dex, coin: { address: v.coin.address, ...(v.coin.decimals !== undefined ? { decimals: v.coin.decimals } : {}) }, quote: { address: v.quote.address, ...(v.quote.kind ? { kind: v.quote.kind } : {}), ...(v.quote.decimals !== undefined ? { decimals: v.quote.decimals } : {}), ...(v.quote.priceUsd ? { priceUsd: v.quote.priceUsd } : {}) } };
    const seen = { ws: new Map<string, number>(), poll: new Map<string, number>() };
    const prices: number[] = [];
    const statuses: [number, FeedState["state"]][] = [];
    const [c0, t0] = [{ ...calls }, Date.now()];
    let state: FeedState["state"] = "reconnecting";
    const bySocket = new Set<string>();                                   // the socket follower's swaps that came while its socket was live
    const note = (who: "ws" | "poll") => (x: Tick) => {
      if (x.tx && !seen[who].has(x.tx)) { seen[who].set(x.tx, Date.now()); if (who === "ws" && state === "live") bySocket.add(x.tx); }
      if (who === "ws") prices.push(x.priceUsd / v.coin.priceUsd);
    };
    const stopW = followSwaps({ rpc: rpcOf("ws"), nativeUsd }, chain, v.coin.address, pool, note("ws"), { pollMs: POLL_MS[chain], ws, onStatus: (s) => { state = s.state; statuses.push([Date.now() - t0, s.state]); } });
    const stopP = followSwaps({ rpc: rpcOf("poll"), nativeUsd }, chain, v.coin.address, pool, note("poll"), { pollMs: POLL_MS[chain] });
    await sleep(SECS * 1000);
    stopW(); stopP();
    const both = [...bySocket].filter((k) => seen.poll.has(k));
    const lead = both.map((k) => seen.poll.get(k)! - seen.ws.get(k)!);
    const bt = await blockTimes(chain, v.pool, [...bySocket].slice(-8));
    const lag = [...bt].map(([k, t]) => seen.ws.get(k)! - t);         // the socket's own swaps only, the last 8
    const liveAt = statuses.find(([, s]) => s === "live")?.[0];
    console.log(`${chain.padEnd(4)} ${v.coin.symbol.slice(0, 10).padEnd(10)} ${v.dex.slice(0, 22).padEnd(22)} socket ${liveAt !== undefined ? `live in ${fmt(liveAt)}` : "never live"} (${statuses.map(([, s]) => s).join(" > ")})`);
    console.log(`     swaps: socket follower ${seen.ws.size} (${bySocket.size} while live), polling ${seen.poll.size}, both ${both.length}; the socket's sooner by ${fmt(median(lead))} (median of ${lead.length}); after the block: socket ${fmt(median(lag))} (median of ${lag.length}${lag.length ? `, max ${fmt(Math.max(...lag))}` : ""})`);
    console.log(`     node calls: socket follower ${calls.ws - c0.ws}, polling follower ${calls.poll - c0.poll}` + (prices.length ? `; socket prices ${Math.min(...prices).toFixed(3)}-${Math.max(...prices).toFixed(3)}x GeckoTerminal's` : ""));
    await sleep(6_000);                                                     // the idle socket closes before the next pool
  }
}
closeAllSockets();
console.log(`\nsockets opened: ${[...new Set(sockets)].join(", ")}`);
process.exit(0);
