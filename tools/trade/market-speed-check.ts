// Trade's market speed, measured on the real network (never in unit tests): how long the real app waits, cold and warm,
// for the first trending list, a coin page, its candles and its logos, through the path the app uses (the market relay
// when the build names one, as the phone and the public web build do), and straight to GeckoTerminal for comparison.
//   node tools/trade/market-speed-check.ts [relay-url]     (default: apps/ios/relay-url.txt)
import { readFileSync } from "node:fs";
import { createMarket } from "../../packages/trade/src/market/index.ts";

const relay = process.argv[2] ?? readFileSync(new URL("../../apps/ios/relay-url.txt", import.meta.url), "utf8").trim();
const ms = (t: number) => `${Math.round(performance.now() - t)} ms`;
const time = async <T>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
  const t = performance.now();
  try { const v = await f(); console.log(`${label.padEnd(44)} ${ms(t)}`); return v; } catch (e) { console.log(`${label.padEnd(44)} FAILED ${ms(t)} ${String((e as Error)?.message ?? e).slice(0, 80)}`); return undefined; }
};

// After (Fork B, 3 Nov): what the screens wait for with paint.ts (device first), prefetch on press, and decoded logos.
{
  console.log(`\n== after: paint first, prefetch on press (${relay})`);
  const { createPaint } = await import("../../packages/trade/src/market/paint.ts");
  const kept = new Map<string, string>();
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k), key: (i: number) => [...kept.keys()][i] ?? null, get length() { return kept.size; } };
  const m1 = createMarket({ relay, storage: null });
  const p1 = createPaint(m1, { storage });
  const rows = await time("first visit: trending all (network)", () => p1.loadList({ kind: "trending", chain: "all" }));
  // the next open of the app (a new page): the list is drawn from the device before any call
  const m2 = createMarket({ relay, storage: null });
  const p2 = createPaint(m2, { storage });
  const t = performance.now();
  const painted = p2.list({ kind: "trending", chain: "all" });
  console.log(`${"next open: trending all, first frame".padEnd(44)} ${(performance.now() - t).toFixed(1)} ms (${painted?.v.length ?? 0} rows)`);
  const row = rows?.[3] ?? rows?.[0];
  if (row) {
    p2.prefetch(row);                                   // finger down on the row
    await new Promise((r) => setTimeout(r, 120));        // a tap's press is ~100-150 ms
    const t2 = performance.now();
    const c = p2.coin(row.chain, row.address), ch = p2.chart(row.chain, row.address, "1D");
    const got = c && ch ? "both painted" : c ? "page painted, chart on its way" : "not yet";
    console.log(`${`coin page ${row.symbol} at tap, after press`.padEnd(44)} ${(performance.now() - t2).toFixed(1)} ms (${got})`);
    await time(`coin page ${row.symbol}, its own call after prefetch`, () => m2.coin(row.chain, row.address));
    await time(`chart 1D ${row.symbol}, its own call after prefetch`, () => m2.candles(row.chain, row.address, "1D"));
  }
  if (rows) await time(`list prices, ${Math.min(30, rows.length)} rows (one call per chain)`, () => p2.livePrices(rows.slice(0, 30)));
}

for (const [name, base] of [["relay", relay], ["direct", undefined]] as const) {
  console.log(`\n== ${name}${base ? ` (${base})` : ""}`);
  const m = createMarket({ ...(base ? { relay: base } : {}), storage: null });
  const all = await time("trending, all chains (cold)", () => m.trending());
  await time("trending, all chains (again, cache)", () => m.trending());
  const sol = await time("trending, Solana (cold)", () => m.trending("sol"));
  const row = sol?.[0] ?? all?.[0];
  if (!row) continue;
  const coin = await time(`coin page ${row.symbol} (cold)`, () => m.coin(row.chain, row.address));
  await time(`candles 1D ${row.symbol} (cold)`, () => m.candles(row.chain, row.address, "1D"));
  if (!coin) continue;
  // logos: the urls the list would show, fetched as an <img> would (no Origin header)
  const urls = (all ?? []).slice(0, 8).map((r) => r.logoUrl).filter((u): u is string => !!u && u.startsWith("http"));
  const t = performance.now();
  const each = await Promise.all(urls.map(async (u) => { const s = performance.now(); try { const r = await fetch(u); await r.arrayBuffer(); return `${r.status}:${Math.round(performance.now() - s)}`; } catch { return `x:${Math.round(performance.now() - s)}`; } }));
  console.log(`${`first ${urls.length} logos, in parallel`.padEnd(44)} ${ms(t)}  [${each.join(" ")}]`);
  const t2 = performance.now();
  const again = await Promise.all(urls.map(async (u) => { const s = performance.now(); try { const r = await fetch(u); await r.arrayBuffer(); return `${r.status}:${Math.round(performance.now() - s)}`; } catch { return `x:${Math.round(performance.now() - s)}`; } }));
  console.log(`${"the same logos again (CDN warm)".padEnd(44)} ${ms(t2)}  [${again.join(" ")}]`);
  console.log(`market calls: ${JSON.stringify(m.stats())}`);
}
