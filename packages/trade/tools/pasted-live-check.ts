// Live check of a pasted contract address when the market data doesn't list the coin: GeckoTerminal is made to answer 404
// for every token (what it says of a coin minutes old), so search and the coin page can only use what the chain says
// (market/onchain.ts, read-only over the free nodes). The coins are GeckoTerminal's own newest launchpad pools on each chain;
// its real price of each is read once beside, to compare. Nothing is signed or sent.
//
//   node packages/trade/tools/pasted-live-check.ts [sol:<mint> | bsc:0x… | hood:0x… …]
//
// Then the same coins can be bought and sold in simulation with tools/sol-live-check.ts and tools/evm-live-check.ts.
import { createMarket } from "../src/market/index.ts";
import { GT_BASE, GT_NETWORK } from "../src/market/gt.ts";
import { createSolRpc } from "../src/sol/rpc.ts";
import { createEvmRpc } from "../src/evm/rpc.ts";
import type { ChainId } from "../src/types.ts";

const LAUNCHPADS: Record<ChainId, RegExp> = { sol: /^(pump-fun|meteora-dbc|raydium-launchlab)$/, hood: /^(pons-v2|hood-fun|robinfun|flap)$/, bsc: /^(four-meme|flap)$/ };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const gt = async (path: string): Promise<any> => { const r = await fetch(`${GT_BASE}/${path}`, { headers: { accept: "application/json" } }); return r.ok ? r.json() : undefined; };

/** GeckoTerminal's newest pools of a launchpad on this chain: [coin, dex, GeckoTerminal's price]. */
async function newest(chain: ChainId, n: number): Promise<[string, string, number | undefined][]> {
  const j = await gt(`networks/${GT_NETWORK[chain]}/new_pools?include=base_token%2Cdex&page=1`);
  const out: [string, string, number | undefined][] = [];
  for (const p of j?.data ?? []) {
    const dex = p.relationships.dex.data.id, coin = String(p.relationships.base_token.data.id).replace(/^[a-z]+_/, "");
    if (LAUNCHPADS[chain].test(dex) && !out.some((o) => o[0] === coin)) out.push([coin, dex, Number(p.attributes.base_token_price_usd) || undefined]);
    if (out.length >= n) break;
  }
  return out;
}

let nodeCalls = 0, gtTokenAsks = 0;
const sol = createSolRpc();
const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
// GeckoTerminal "doesn't list" any token; everything else (CoinGecko's native prices) is real
const noTokens: typeof fetch = async (u, i) => (/\/tokens\//.test(String(u)) ? (gtTokenAsks++, new Response("{}", { status: 404 })) : fetch(u, i));
const market = createMarket({ fetch: noTokens, storage: null, solRpc: (m, p) => { nodeCalls++; return sol.call(m, p); }, evmRpc: (c, m, p) => { nodeCalls++; return evm[c].call(m, p); } });

const args = process.argv.slice(2).map((a) => a.split(":") as [ChainId, string]);
const plan: [ChainId, string, string, number | undefined][] = [];
if (args.length) for (const [c, a] of args) plan.push([c, a, "?", undefined]);
else for (const c of ["sol", "hood", "bsc"] as ChainId[]) { for (const [a, dex, px] of await newest(c, 3)) plan.push([c, a, dex, px]); await sleep(2_500); }

console.log("GeckoTerminal answers 404 for every token here; only the chain is read. Nothing is signed or sent.\n");
let found = 0;
for (const [chain, address, dex, gtPx] of plan) {
  const [t0, n0] = [performance.now(), nodeCalls];
  try {
    const rows = (await market.search(address)).filter((r) => r.chain === chain);
    const searchMs = performance.now() - t0, searchCalls = nodeCalls - n0;
    const row = rows[0];
    if (!row) { console.log(`${chain.padEnd(4)} ${dex.padEnd(18)} ${short(address)}  NOT FOUND (${searchCalls} node calls, ${searchMs.toFixed(0)} ms)`); continue; }
    const [t1, n1] = [performance.now(), nodeCalls];
    const d = await market.coin(chain, row.address);
    const vs = d.priceUsd && gtPx ? ` (${(d.priceUsd / gtPx).toFixed(3)}x GeckoTerminal's ${gtPx.toPrecision(4)})` : gtPx ? ` (GeckoTerminal: ${gtPx.toPrecision(4)})` : "";
    found++;
    console.log(`${chain.padEnd(4)} ${dex.padEnd(18)} ${short(address)}  ${String(d.symbol).slice(0, 12).padEnd(12)} "${String(d.name ?? "").slice(0, 20)}"  decimals ${d.decimals}  price ${d.priceUsd ? "$" + d.priceUsd.toPrecision(4) : "none"}${vs}  mcap ${d.marketCapUsd ? "$" + Math.round(d.marketCapUsd).toLocaleString("en-US") : "-"}  pools ${(d.pools ?? []).map((p) => p.dex).join(",") || "-"}` +
      `${d.security ? `  mint ${d.security.mintAuthority ? "open" : "closed"} freeze ${d.security.freezeAuthority ? "SET" : "none"}` : ""}\n` +
      `     search ${searchMs.toFixed(0)} ms (${searchCalls} node calls) · coin page ${(performance.now() - t1).toFixed(0)} ms (${nodeCalls - n1}, cached for 10 s)`);
  } catch (e) {
    console.log(`${chain} ${short(address)}: ${(e as Error).name}: ${(e as Error).message}`);
  }
}
console.log(`\n${found} of ${plan.length} found from the chain alone; GeckoTerminal token calls made (all answered 404 here): ${gtTokenAsks}`);
