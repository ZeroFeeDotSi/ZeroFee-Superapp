// Live check of the market data module against the real public APIs (read only, no key, nothing is signed or sent):
//   node packages/trade/tools/market-live-check.ts
// Per chain: trending top 5 (GeckoTerminal's own order), one coin's details with its pools and dex ids, a candle count; one name search across the chains;
// the native prices; a live price tick; and how many calls were made (the budget is 25 a minute).
import { MarketError, createMarket } from "../src/market/index.ts";
import type { ChainId } from "../src/types.ts";

const m = createMarket();
const ms = (t0: number) => `${Math.round(performance.now() - t0)} ms`;
const money = (n?: number) => (n === undefined ? "-" : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toPrecision(4));
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const names: Record<ChainId, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain" };
const t00 = performance.now();
// the check spaces its calls out a little: this machine's IP is shared, and GeckoTerminal's free tier is strict about bursts
const pause = () => new Promise((r) => setTimeout(r, 2500));
/** If the call budget was used up (a 429 from the service blocks every call for a few seconds), wait it out once and ask again, as a screen would. */
async function patient<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof MarketError && e.code === "rate") { console.log("  (rate limited, waiting 12 s)"); await new Promise((r) => setTimeout(r, 12_000)); return fn(); }
    throw e;
  }
}

let t = performance.now();
const q = await patient(() => m.search("pepe")).catch((e) => { console.log("search failed:", String(e)); return []; });
console.log(`search "pepe": ${q.length} rows in ${ms(t)}`);
for (const c of ["sol", "bsc", "hood"] as ChainId[]) {
  const rows = q.filter((r) => r.chain === c);
  console.log(`  ${names[c]}: ${rows.length} rows, e.g. ${rows.slice(0, 3).map((r) => `${r.symbol} $${money(r.priceUsd)} liq $${money(r.liquidityUsd)}`).join(" | ") || "-"}`);
}

for (const chain of ["sol", "bsc", "hood"] as ChainId[]) {
  await pause();
  console.log(`\n== ${names[chain]} ==`);
  t = performance.now();
  const tr = await patient(() => m.trending(chain)).catch((e) => { console.log("trending failed:", String(e)); return []; });
  console.log(`trending: ${tr.length} rows in ${ms(t)} (GeckoTerminal's order)`);
  for (const r of tr.slice(0, 5)) console.log(`  ${r.symbol.padEnd(10)} ${short(r.address).padEnd(14)} $${money(r.priceUsd).padEnd(10)} 24h ${r.change24hPct ?? "-"}%  liq $${money(r.liquidityUsd)}  logo ${r.logoUrl ? "yes" : "monogram"}`);
  const top = tr[0];
  if (!top) continue;
  t = performance.now();
  const d = await patient(() => m.coin(chain, top.address)).catch((e) => { console.log("coin failed:", String(e)); return undefined; });
  if (d) {
    console.log(`coin ${d.symbol} (${d.name}) in ${ms(t)}: price $${money(d.priceUsd)}, liquidity $${money(d.liquidityUsd)}, mcap $${money(d.marketCapUsd)}, vol24h $${money(d.volume24hUsd)}, holders ${d.holders ?? "-"}, decimals ${d.decimals}, 24h ${d.change24hPct ?? "-"}%, move60s ${d.moveBps60s ?? "-"} bps, security ${JSON.stringify(d.security ?? null)}`);
    console.log(`  pools: ${d.pools?.map((p) => `${p.dex} ($${money(p.liquidityUsd)})`).join(", ")}`);
    t = performance.now();
    const meta = await m.meta(chain, top.address);
    console.log(`meta() from cache in ${ms(t)}: ${meta?.pools?.length} pools`);
    t = performance.now();
    const cs = await patient(() => m.candles(chain, top.address, "1D")).catch((e) => { console.log("candles failed:", String(e)); return []; });
    console.log(`candles 1D: ${cs.length} in ${ms(t)}${cs.length ? `, first ${new Date(cs[0]!.t).toISOString()}, last close $${money(cs.at(-1)!.c)}` : ""}`);
  }
}

console.log("\n== native prices ==");
t = performance.now();
for (const c of ["sol", "bsc", "hood"] as ChainId[]) console.log(`  ${c}: $${money(await m.nativeUsd(c).catch(() => undefined))}`);
console.log(`  (${ms(t)})`);

const top = (await m.trending("sol").catch(() => []))[0];
if (top) {
  console.log("\n== live price (polling) ==");
  await new Promise<void>((done) => {
    const m2 = createMarket({ livePollMs: 3000 });
    const stop = m2.livePrice("sol", top.address, (p, at) => { console.log(`  ${top.symbol} $${money(p)} at ${new Date(at).toISOString()}`); stop(); done(); });
    setTimeout(() => { stop(); done(); }, 8000);
  });
}
console.log(`\ncalls to GeckoTerminal: ${JSON.stringify(m.stats())}, total ${ms(t00)}`);
