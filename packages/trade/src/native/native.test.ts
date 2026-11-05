// Native coins (product decision, 5 Nov, items 4-5): the list covers every asset 1Click lists, ranked best 24 h first; Safe coin
// pages open by "coin:intents:<asset id>"; Buy/Sell is ONE path (ledger.swapQuote, ledger.swap), its job published at
// the tap; the result is said only from done swaps that carry what arrived. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cgFallbackIds, cgLogoPath, GT_MULTI_MAX, gtKey, gtMultiPaths, logoVia, nativeCoins, rankNative, readGtTokens, readMarkets, readTokens, searchNative, SAFE_CASH } from "./assets.ts";
import { createNativeData, readFacts, readOhlcv } from "./data.ts";
import { amountIn, heldOf, NATIVE_WORDS, resultOf, resumeSwapJobs, runSwap, safeCashOf, sellStart, SHEET_WORDS, type SafeQuote, type SwapMove, type SwapView } from "./swap.ts";
import { safeCanSell } from "@zerofee/core/band-coins";
import { coinRoute, readRequest, segOfRequest } from "../app/requests.ts";
import { NATIVE_COPY } from "./words.ts";

const TOKENS = [
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 4, contractAddress: "wrap.near", coingeckoId: "wrapped-near" },
  { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 3000, coingeckoId: "ethereum" },
  { assetId: "nep141:base.omft.near", decimals: 18, blockchain: "base", symbol: "ETH", price: 3000, coingeckoId: "ethereum" },
  { assetId: SAFE_CASH, decimals: 6, blockchain: "near", symbol: "USDC", price: 1, coingeckoId: "usd-coin" },
  { assetId: "nep141:sol-abc.omft.near", decimals: 6, blockchain: "sol", symbol: "TLO", price: 0.1 },
  { assetId: "bad id", decimals: 6, blockchain: "near", symbol: "X" },
  { assetId: "nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", decimals: 18, blockchain: "near", symbol: "AURORA", contractAddress: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", coingeckoId: "aurora-near" },
];
const MARKETS = [
  { id: "wrapped-near", name: "NEAR", image: "https://coin-images.coingecko.com/coins/images/10365/large/near.jpg?1", current_price: 4, price_change_percentage_24h: 9, total_volume: 5e6, market_cap: 5e9 },
  { id: "ethereum", name: "Ethereum", current_price: 3000, price_change_percentage_24h: 2, total_volume: 1e9, market_cap: 3e11 },
  { id: "aurora-near", name: "Aurora", symbol: "aurora", current_price: 0.05, price_change_percentage_24h: 1, total_volume: 1e6 },
  { id: "usd-coin", name: "USDC", current_price: 1, price_change_percentage_24h: 0.01, total_volume: 1e10 },
];

test("the list: every asset 1Click lists but the cash that pays; best 24 h first; searchable", () => {
  const coins = nativeCoins(readTokens(TOKENS));
  assert.equal(coins.length, 5, "ETH on two chains is two rows; a bad id is dropped; the cash is out");
  const rows = rankNative(coins, readMarkets(MARKETS));
  assert.equal(rows[0]!.assetId, "nep141:wrap.near", "+9 % first");
  assert.deepEqual(rows.map((r) => r.symbol), ["NEAR", "ETH", "AURORA", "ETH", "TLO"], "one ETH among the best; its other chain after (control: still listed)");
  assert.equal(rows.at(-1)!.assetId, "nep141:sol-abc.omft.near", "no market: last, still listed (the Safe can buy it)");
  assert.deepEqual(searchNative(rows, "eth").map((r) => r.blockchain).sort(), ["base", "eth"]);
  assert.equal(searchNative(rows, "").length, 5, "control: the empty search is the whole list");
  assert.equal(coins.find((c) => c.assetId === "nep141:wrap.near")!.gt?.network, "near");
  assert.equal(coins.find((c) => c.assetId === "nep141:eth.omft.near")!.gt?.address, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "a chain's coin: its wrapped twin on GeckoTerminal");
});

test("logos only through the relay, CoinGecko's path only; none: the letter mark", () => {
  assert.equal(cgLogoPath("https://coin-images.coingecko.com/coins/images/10365/large/near.jpg?1696502"), "10365/large/near.jpg");
  assert.equal(logoVia("https://relay.example", "https://coin-images.coingecko.com/coins/images/1/large/b.png"), "https://relay.example/v0/market/logo?cg=1%2Fsmall%2Fb.png");
  assert.equal(cgLogoPath("https://evil.example/coins/images/1/large/b.png"), undefined, "control: another host");
  assert.equal(logoVia(undefined, "https://coin-images.coingecko.com/coins/images/1/large/b.png"), undefined, "control: no relay, no image");
  // GeckoTerminal's own image: the relay finds it by the coin's address where its logo route serves the chain
  assert.equal(logoVia("https://relay.example", "https://assets.geckoterminal.com/x/y.png", true, { network: "near", address: "token.v2.ref-finance.near" }), "https://relay.example/v0/market/logo?c=near&a=token.v2.ref-finance.near");
  assert.equal(logoVia("https://relay.example", "https://assets.geckoterminal.com/x/y.png", true, { network: "solana", address: "So11111111111111111111111111111111111111112" }), "https://relay.example/v0/market/logo?c=sol&a=So11111111111111111111111111111111111111112");
  assert.equal(logoVia("https://relay.example", "https://assets.geckoterminal.com/x/y.png", true, { network: "eth", address: "0xab" }), undefined, "control: a chain the logo route doesn't serve: the letter mark");
  assert.equal(logoVia("https://relay.example", "https://evil.example/y.png", true, { network: "near", address: "a.near" }), undefined, "control: another host, even with an address");
});

// GeckoTerminal's tokens/multi answer, recorded 5 Nov 2026 (eth WETH, trimmed), plus a coin that is its top pool's quote
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const gtToken = (net: string, addr: string, o: { sym: string; name: string; price: string; img?: string; pool: string; base: boolean; h24: string; vol?: string; mcap?: string | null; fdv?: string }) => ({
  token: { id: `${net}_${addr}`, type: "token", attributes: { address: addr, name: o.name, symbol: o.sym, image_url: o.img ?? "missing.png", price_usd: o.price, fdv_usd: o.fdv ?? "5014939750.7", volume_usd: { h24: o.vol ?? "664878776.1" }, market_cap_usd: o.mcap === undefined ? "5061002993.5" : o.mcap }, relationships: { top_pools: { data: [{ id: `${net}_${o.pool}`, type: "pool" }] } } },
  pool: { id: `${net}_${o.pool}`, type: "pool", attributes: { price_change_percentage: { h24: o.h24 } }, relationships: { base_token: { data: { id: o.base ? `${net}_${addr}` : `${net}_0xother` } } } },
});
const multi = (...t: ReturnType<typeof gtToken>[]) => ({ data: t.map((x) => x.token), included: t.map((x) => x.pool) });
const GT_ETH = multi(gtToken("eth", WETH, { sym: "WETH", name: "Wrapped Ether", price: "2418.95", img: "https://coin-images.coingecko.com/coins/images/2518/large/weth.png?1696503332", pool: "0x88e6", base: true, h24: "7.178" }));
const GT_NEAR = multi(
  gtToken("near", "wrap.near", { sym: "wNEAR", name: "Wrapped NEAR", price: "4.1", img: "https://assets.geckoterminal.com/abc/near.png", pool: "refv1-1", base: false, h24: "-3", mcap: null, fdv: "4000000000", vol: "9000000" }),
  gtToken("near", "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", { sym: "AURORA", name: "Aurora", price: "0.06", pool: "refv1-2", base: true, h24: "12", vol: "2000000" }),
);

test("GeckoTerminal: one multi call per network per 30 coins; a shared twin asked once; cash never asked", () => {
  const coins = nativeCoins(readTokens(TOKENS));
  const paths = gtMultiPaths(coins);
  assert.deepEqual(paths.map((p) => p.network), ["eth", "near"], "ETH on two chains is ONE WETH address; TLO's chain has no contract here");
  assert.equal(paths[0]!.path, `networks/eth/tokens/multi/${WETH}?include=top_pools`);
  assert.equal(paths[1]!.path, "networks/near/tokens/multi/aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near,wrap.near?include=top_pools");
  assert.ok(!paths.some((p) => p.path.includes("17208628")), "control: the Safe's cash is never a row, never asked");
  const many = Array.from({ length: GT_MULTI_MAX + 1 }, (_, i) => ({ assetId: `nep141:t${i}.near`, decimals: 6, blockchain: "eth", symbol: `T${i}`, contractAddress: `0x${String(i).padStart(40, "0")}` }));
  const big = gtMultiPaths(nativeCoins(readTokens(many)));
  assert.deepEqual(big.map((p) => p.path.split("/").at(-1)!.split("?")[0]!.split(",").length), [30, 1], "31 coins: two calls, 30 then 1");
  assert.equal(gtMultiPaths(nativeCoins(readTokens(many.slice(0, 30)))).length, 1, "control: 30 coins, one call");
  const usdt = { assetId: "nep141:usdt.near", decimals: 6, blockchain: "eth", symbol: "USDT", contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7" };
  assert.ok(gtMultiPaths(nativeCoins(readTokens([...many.slice(0, 29), usdt])))[0]!.path.includes("0xdac17f958d2ee523a2206206994597c13d831ec7"), "cash rides in a batch with room (its logo)");
  assert.equal(gtMultiPaths(nativeCoins(readTokens([...many.slice(0, 30), usdt]))).length, 1, "control: cash never adds a call");
  assert.equal(gtMultiPaths(nativeCoins(readTokens([usdt]))).length, 0, "control: a network with only cash is not asked");
  assert.equal(gtMultiPaths(nativeCoins(readTokens([{ ...many[0]!, contractAddress: "0xab/../x" }]))).length, 0, "control: an address with a separator is never asked");
});

test("GeckoTerminal's answer: price, cap, FDV, volume, image; the day's move only when the coin is its top pool's base", () => {
  const m = readGtTokens(GT_NEAR, "near");
  const w = m.get(gtKey({ network: "near", address: "wrap.near" }))!;
  assert.equal(w.price, 4.1);
  assert.equal(w.change24h, undefined, "wNEAR is its pool's quote: the pool's move is the other coin's");
  assert.equal(w.marketCap, undefined, "GeckoTerminal has no cap: none, never a guess");
  assert.equal(w.fdv, 4e9);
  assert.equal(w.image, "https://assets.geckoterminal.com/abc/near.png");
  const a = m.get(gtKey({ network: "near", address: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near" }))!;
  assert.equal(a.change24h, 12, "control: AURORA is its pool's base: its move");
  assert.equal(a.image, undefined, "GeckoTerminal's missing.png is no image (the letter mark)");
  assert.equal(readGtTokens({ data: [{ type: "token", id: "x", attributes: { address: "bad addr" } }] }, "near").size, 0, "control: a malformed answer adds nothing");
  // ranking: GeckoTerminal's figures first; CoinGecko only for what it lacks (wNEAR's move, TLO is not on GeckoTerminal here)
  const coins = nativeCoins(readTokens(TOKENS));
  const gt = readGtTokens(GT_ETH, "eth", readGtTokens(GT_NEAR, "near"));
  assert.deepEqual(cgFallbackIds(coins, gt), ["wrapped-near"], "only the coin GeckoTerminal has no move for (cash never; ETH and AURORA it has)");
  assert.deepEqual(cgFallbackIds(coins, new Map()).sort(), ["aurora-near", "ethereum", "wrapped-near"], "control: GeckoTerminal empty, CoinGecko for every coin with an id");
  const rows = rankNative(coins, readMarkets(MARKETS.filter((x) => x.id === "wrapped-near")), gt);
  assert.deepEqual(rows.map((r) => r.symbol), ["AURORA", "NEAR", "ETH", "ETH", "TLO"]);
  const eth = rows.find((r) => r.assetId === "nep141:eth.omft.near")!;
  assert.equal(eth.price, 2418.95, "GeckoTerminal's price, not CoinGecko's");
  assert.equal(eth.change24h, 7.178);
  assert.equal(eth.name, "ETH", "WETH's name isn't ETH's: the row keeps its symbol");
  assert.equal(logoVia("https://r.example", eth.logo), "https://r.example/v0/market/logo?cg=2518%2Fsmall%2Fweth.png", "GeckoTerminal's image of a listed coin: the relay's CoinGecko path");
  const wn = rows.find((r) => r.assetId === "nep141:wrap.near")!;
  assert.deepEqual([wn.price, wn.change24h], [4, 9], "the move and its price from ONE source (CoinGecko's pair), never mixed");
  assert.equal(wn.logo, "https://assets.geckoterminal.com/abc/near.png", "the logo stays GeckoTerminal's");
});

test("coin:intents:<id>[:SYM] opens a Safe coin's page; a malformed id is the market", () => {
  assert.deepEqual(readRequest("coin:intents:nep141:wrap.near:NEAR"), { native: { assetId: "nep141:wrap.near", symbol: "NEAR" } });
  assert.deepEqual(readRequest("coin:intents:nep141:sol.omft.near"), { native: { assetId: "nep141:sol.omft.near", symbol: "" } });
  assert.deepEqual(readRequest("coin:intents:nep245:v2_1.omni.hot.tg:56_11111111111111111111:BNB"), { native: { assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", symbol: "BNB" } });
  assert.equal(readRequest(coinRoute({ chain: "intents", assetId: "nep141:wrap.near", symbol: "NEAR" })).hasOwnProperty("native"), true, "the entry and the reader agree");
  for (const bad of ["coin:intents:wrap.near", "coin:intents:nep141:", "coin:intents:nep141:Bad..Id!:X", "coin:intents:"]) assert.deepEqual(readRequest(bad), { market: "all" }, bad);
  assert.equal("coin" in readRequest("coin:sol:So11111111111111111111111111111111111111112:SOL"), true, "control: a Hot coin keeps today's page");
});

test("what a swap pays: dollars of USDC; a sale's dollars of the coin, never above what is held; All is the held amount", () => {
  assert.equal(amountIn({ side: "buy", usd: 25, decimals: 24 }), "25");
  assert.equal(amountIn({ side: "buy", usd: 0, decimals: 24 }), null, "control: nothing typed");
  assert.equal(amountIn({ side: "sell", usd: 8, price: 4, held: "3.5", decimals: 24 }), "2");
  assert.equal(amountIn({ side: "sell", usd: 80, price: 4, held: "3.5", decimals: 24 }), "3.5", "capped at the held amount");
  assert.equal(amountIn({ side: "sell", usd: 1, all: true, held: "3.123456789012345678901234", decimals: 24 }), "3.123456789012345678901234");
  assert.equal(amountIn({ side: "sell", usd: 8, price: 4, held: null as never, decimals: 24 }), null, "control: nothing held");
});

test("holdings are the Safe's in-place rows only; the result needs done swaps that carry what arrived", () => {
  const rows = [{ tokenId: "nep141:wrap.near", amount: "5", held: "account" }, { tokenId: "nep141:wrap.near", amount: "2.5", held: "ledger" }];
  assert.equal(heldOf(rows, "nep141:wrap.near"), "2.5");
  assert.equal(heldOf([rows[0]!], "nep141:wrap.near"), null, "control: on the NEAR account, not in place");
  const buy = { kind: "swap", status: "done", from: SAFE_CASH, to: "nep141:wrap.near", amount: "10", amountOut: "2.5" };
  assert.deepEqual(resultOf([buy], "nep141:wrap.near", 2.5, 5), { usd: 2.5, pct: 25 });
  assert.equal(resultOf([{ ...buy, amountOut: undefined }], "nep141:wrap.near", 2.5, 5), null, "control: no amountOut, no figure");
  assert.equal(resultOf([buy], "nep141:wrap.near", 4, 5), null, "more held than recorded buys: no guessed basis");
});

function fakeBridge(o: { swap: (p: unknown) => unknown; after?: (emit: (m: SwapMove) => void) => void; activity?: SwapMove[] }) {
  const calls: string[] = [];
  let handler: ((p: { movement: SwapMove }) => void) | undefined;
  const bridge = {
    async call(method: string, p?: Record<string, unknown>) {
      calls.push(method);
      if (method === "ledger.swap") { const r = o.swap(p); queueMicrotask(() => o.after?.((m) => handler?.({ movement: m }))); return r; }
      if (method === "ledger.activity") { queueMicrotask(() => o.after?.((m) => handler?.({ movement: m }))); return { ok: o.activity ?? [] }; }
      return { ok: null };
    },
    on(_e: string, h: (p: { movement: SwapMove }) => void) { handler = h; return () => { handler = undefined; }; },
  };
  const log: string[] = [];
  const tasks = {
    publish: (t: { id: string; title: string; detail?: string }) => { log.push(`publish:${t.title}:${t.detail ?? ""}`); log.push(`calls-before:${calls.length}`); return true; },
    update: (_id: string, p: { detail?: string }) => { log.push(`update:${p.detail ?? ""}`); return true; },
    end: (_id: string, s: string, d?: string) => { log.push(`end:${s}:${d ?? ""}`); return true; },
    open: () => undefined,
  };
  return { bridge: bridge as never, tasks: tasks as never, calls, log };
}
const Q: SafeQuote = { id: "q1", from: SAFE_CASH, to: "nep141:wrap.near", amountIn: "25", amountOut: "6.2", minOut: "6.1", feeUsd: 0.05, etaSeconds: 11, expiresAtIso: new Date(Date.now() + 30_000).toISOString(), source: "safe" };
const MOVE: SwapMove = { id: "m1", kind: "swap", status: "moving", from: SAFE_CASH, to: "nep141:wrap.near", amount: "25" };

test("Buy: the job is published at the tap with 1Click's own time, BEFORE ledger.swap; it ends on the ledger's done", async () => {
  const f = fakeBridge({ swap: () => ({ ok: MOVE }), after: (emit) => emit({ ...MOVE, status: "done", amountOut: "6.2", settledMs: 9_800 }) });
  const end = await runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "Buy $25.00 of NEAR", usd: "$25.00", quote: Q, tapMs: Date.now() });
  assert.equal(end, "done");
  assert.equal(f.log[0], "publish:Buy $25.00 of NEAR:NEAR Intents says about 11 s");
  assert.equal(f.log[1], "calls-before:0", "nothing asked of the ledger before the job exists");
  assert.deepEqual(f.calls, ["ledger.swap"]);
  assert.ok(f.log.includes("update:Took 9.8 s."), "the protocol's measured time");
  assert.equal(f.log.at(-1), "end:done:");
});

test("control: a refused swap ends failed with the ledger's own words; an expired quote never reaches ledger.swap", async () => {
  const f = fakeBridge({ swap: () => ({ problem: { whatHappened: "Your Safe has too little USDC." } }) });
  assert.equal(await runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "x", usd: "$1.00", quote: Q, tapMs: Date.now() }), "failed");
  assert.equal(f.log.at(-1), "end:failed:Your Safe has too little USDC.");
  const g = fakeBridge({ swap: () => ({ ok: MOVE }) });
  assert.equal(await runSwap({ bridge: g.bridge, tasks: g.tasks, taskId: "t", title: "x", usd: "$1.00", quote: { ...Q, expiresAtIso: new Date(Date.now() - 1).toISOString() }, tapMs: Date.now() }), "failed");
  assert.deepEqual(g.calls, []);
  const h = fakeBridge({ swap: () => ({ ok: MOVE }), after: (emit) => emit({ ...MOVE, status: "problem", problem: { whatHappened: "" } }) });
  assert.equal(await runSwap({ bridge: h.bridge, tasks: h.tasks, taskId: "t", title: "x", usd: "$1.00", quote: Q, tapMs: Date.now() }), "failed");
  assert.equal(h.log.at(-1), `end:failed:${NATIVE_WORDS.refunded}`);
});

/** A memory store, as localStorage. */
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

test("a refund reads Refunded, nothing lost, on the job and the sheet; a done swap's receipt is what arrived (the ledger's), not the quote", async () => {
  const views: SwapView[] = [];
  const f = fakeBridge({ swap: () => ({ ok: MOVE }), after: (emit) => emit({ ...MOVE, status: "refunded" }) });
  assert.equal(await runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "x", usd: "$25.00", quote: Q, tapMs: Date.now(), onView: (v) => views.push(v), storage: mem() }), "failed");
  assert.match(NATIVE_WORDS.refunded, /Refunded, nothing lost/);
  assert.equal(f.log.at(-1), `end:failed:${NATIVE_WORDS.refunded}`);
  assert.equal(views.at(-1)?.line, SHEET_WORDS.refunded);
  const g = fakeBridge({ swap: () => ({ ok: MOVE }), after: (emit) => emit({ ...MOVE, status: "done", amountOut: "6.15", settledMs: 2_000 }) });
  const seen: SwapView[] = [];
  assert.equal(await runSwap({ bridge: g.bridge, tasks: g.tasks, taskId: "t", title: "x", usd: "$25.00", quote: Q, tapMs: Date.now(), onView: (v) => seen.push(v), storage: mem() }), "done");
  assert.equal(seen.at(-1)?.got, "6.15", "1Click's settled figure, not the quote's 6.2");
});

test("past 10 minutes a swap job says it is still checking and KEEPS following to the ledger's end (never 'moving' forever); control: the job is kept for a reload until it ends", async () => {
  let t = 0;
  const store = mem();
  let emit: ((m: SwapMove) => void) | undefined;
  const f = fakeBridge({ swap: () => ({ ok: MOVE }), after: (e) => { emit = e; } });
  const timers: (() => void)[] = [];
  const run = runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "x", usd: "$25.00", quote: Q, tapMs: 0, now: () => t, timer: (fn) => (timers.push(fn), () => undefined), storage: store });
  await new Promise((r) => setImmediate(r));
  assert.ok(store.m.get("zf.trade.native-jobs")?.includes('"moveId":"m1"'), "kept while it runs");
  t = 11 * 60_000;
  timers.splice(0).forEach((fn) => fn());
  await new Promise((r) => setImmediate(r));
  assert.ok(f.log.includes(`update:${NATIVE_WORDS.checking}`), "said once");
  emit!({ ...MOVE, status: "done", amountOut: "6.2" });
  assert.equal(await run, "done", "it ended on the ledger's read, after the 10 minutes");
  assert.equal(store.m.get("zf.trade.native-jobs"), "{}", "dropped once it ended");
});

test("a reload: a kept swap job ends from the ledger's own record (refunded here), or follows it until it does; control: nothing kept, nothing read", async () => {
  const store = mem();
  store.setItem("zf.trade.native-jobs", JSON.stringify({ "native-buy-x-1": { moveId: "m1", tapMs: 1 }, "native-buy-y-2": { moveId: "m2", tapMs: 2 } }));
  const f = fakeBridge({ swap: () => ({}), activity: [{ ...MOVE, status: "refunded" }, { ...MOVE, id: "m2" }], after: (emit) => emit({ ...MOVE, id: "m2", status: "done", amountOut: "6.2" }) });
  await resumeSwapJobs({ bridge: f.bridge, tasks: f.tasks, storage: store, timer: (fn) => { const x = setTimeout(fn, 1); return () => clearTimeout(x); } });
  assert.ok(f.log.includes(`end:failed:${NATIVE_WORDS.refunded}`), JSON.stringify(f.log));
  assert.ok(f.log.includes("end:done:"), "the one still moving ended on the ledger's update");
  assert.equal(store.m.get("zf.trade.native-jobs"), "{}");
  const g = fakeBridge({ swap: () => ({}) });
  await resumeSwapJobs({ bridge: g.bridge, tasks: g.tasks, storage: mem() });
  assert.deepEqual(g.calls, []);
});

test("Buy only what the Safe can also sell today: the one check (band-coins.ts safeCanSell); control: a coin the bands don't list is Soon", () => {
  for (const id of ["nep141:wrap.near", "nep141:eth.omft.near", SAFE_CASH, "nep141:usdt.tether-token.near"]) assert.equal(safeCanSell(id), true, id);
  for (const id of ["nep141:blackdragon.tkn.near", "nep245:v2_1.omni.hot.tg:56_11111111111111111111", "nep141:sol-abc.omft.near"]) assert.equal(safeCanSell(id), false, id);
});

test("market data: GeckoTerminal's candles oldest first, the pool's side; the list's calls; the last list stays when the markets are busy", async () => {
  assert.deepEqual(readOhlcv({ data: { attributes: { ohlcv_list: [[2, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 0], ["x"]] } } }).map((c) => c.t), [1000, 2000]);
  const pool = { type: "pool", attributes: { address: "p", name: "USDT / wNEAR", reserve_in_usd: "7" }, relationships: { base_token: { data: { id: "near_usdt.near" } }, dex: { data: { id: "rhea-finance" } } } };
  const f = readFacts({ data: { attributes: { total_reserve_in_usd: "10", volume_usd: { h24: "5" } } }, included: [pool] }, { network: "near", address: "wrap.near" });
  assert.equal(f.pools[0]!.side, "quote", "wNEAR is the pool's quote token: its chart asks for that side");
  assert.equal(f.liquidityUsd, 10);
  const { fetch, asked, state } = marketFake();
  let t = 0;
  const d = createNativeData({ fetch, storage: null, now: () => t, relay: RELAY });
  const first = await d.refreshList();
  assert.equal(first[0]!.symbol, "AURORA");
  assert.equal(first[0]!.price, 0.06, "GeckoTerminal's price");
  assert.deepEqual(asked.map((u) => u.split("?")[0]!.replace(/multi\/.*/, "multi")), ["https://1click.chaindefuser.com/v0/tokens", `${RELAY}/v0/market/gt/networks/eth/tokens/multi`, `${RELAY}/v0/market/gt/networks/near/tokens/multi`, `${RELAY}/v0/market/cg/coins/markets`], "one list load: 1Click, a multi call per network, ONE CoinGecko call, the markets through the relay only");
  assert.ok(asked.at(-1)!.includes("ids=wrapped-near&"), "CoinGecko asked only for what GeckoTerminal lacks");
  const n = asked.length;
  await d.refreshList();
  assert.equal(asked.length, n, "control: within the minute nothing is asked again");
  state.busy = 429; t += 120_000;
  const again = await d.refreshList();
  assert.equal(again[0]!.price, 0.06, "the kept answer, never a blank price");
  assert.ok(asked.every((u) => !u.startsWith("https://api.geckoterminal.com") && !u.startsWith("https://api.coingecko.com")), "the relay busy: the keyless public API is never asked");
  assert.equal(NATIVE_COPY.notice(10), "Buys and sells happen inside your Safe · about 10 s today");
  assert.equal(NATIVE_COPY.notice(), "Buys and sells happen inside your Safe", "control: no time from 1Click, none said");
});

const RELAY = "https://relay.example";
/** 1Click and the relay's market door. `state.busy`: the relay's market answers that status (or "dead": no answer at
 *  all, "slow": an answer only when the caller gives up); `state.down`: these networks' batches only. */
function marketFake() {
  const asked: string[] = [];
  const state: { busy?: number | "dead" | "slow"; down?: string[]; oneclick?: "dead" | undefined } = {};
  const fetch = (async (u: string, init?: RequestInit) => {
    asked.push(u);
    if (u.includes("1click.chaindefuser.com/v0/tokens")) { if (state.oneclick) throw new TypeError("Failed to fetch"); return new Response(JSON.stringify(TOKENS), { status: 200 }); }
    if (!u.startsWith(`${RELAY}/v0/market/`)) return new Response("", { status: 429 }); // a public market API: never to be asked
    if (state.busy === "dead") throw new TypeError("Failed to fetch");
    if (state.busy === "slow") return new Promise<Response>((_, no) => init?.signal?.addEventListener("abort", () => no(new DOMException("timed out", "TimeoutError"))));
    if (typeof state.busy === "number") return new Response("", { status: state.busy });
    if (state.down?.some((n) => u.includes(`/networks/${n}/tokens/multi/`))) return new Response("", { status: 502 });
    const body = u.includes("/gt/networks/eth/tokens/multi/") ? GT_ETH : u.includes("/gt/networks/near/tokens/multi/") ? GT_NEAR : u.includes("/cg/coins/markets") ? MARKETS : null;
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked, state };
}
const isPublicMarket = (u: string) => u.startsWith("https://api.geckoterminal.com") || u.startsWith("https://api.coingecko.com");

test("row 23: logos stay when a network's market batch fails (dead, slow, busy); control: with the batch answering, its own logo", async () => {
  for (const fail of [502, 429, 503] as const) {
    const { fetch, asked, state } = marketFake();
    let t = 0;
    const d = createNativeData({ fetch, storage: mem(), now: () => t, relay: RELAY });
    const first = await d.refreshList();
    const weth = (rs: typeof first) => rs.find((r) => r.assetId === "nep141:eth.omft.near")!;
    assert.match(weth(first).logo ?? "", /coin-images\.coingecko\.com\/coins\/images\/2518\//, "control: GeckoTerminal's image for WETH");
    // the eth batch fails on the next minute's load, near still answers: the list is recomputed, eth's logo kept
    state.down = ["eth"]; t += 120_000;
    if (fail !== 502) { state.down = undefined; state.busy = fail; }
    const next = await d.refreshList();
    assert.match(weth(next).logo ?? "", /2518/, `${fail}: the last logo stays`);
    assert.ok(!asked.some(isPublicMarket), `${fail}: never the keyless public API`);
  }
  // after a reload (the batches' answers live in memory only) the eth batch fails and near answers: the list is
  // recomputed and WETH's logo comes from the kept logos
  const { fetch, state } = marketFake();
  const store = mem();
  await createNativeData({ fetch, storage: store, now: () => 0, relay: RELAY }).refreshList();
  state.down = ["eth"];
  const after = await createNativeData({ fetch, storage: store, now: () => 120_000, relay: RELAY }).refreshList();
  assert.match(after.find((r) => r.assetId === "nep141:eth.omft.near")!.logo ?? "", /2518/, "reload + a dead batch: the kept logo");
  assert.equal(after.find((r) => r.assetId === "nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near")!.price, 0.06, "control: the answering batch's own figures");
  store.m.delete("zerofee-native:v1:logos");
  const without = await createNativeData({ fetch, storage: { getItem: (k) => (k.endsWith("rows") ? null : store.getItem(k)), setItem: () => undefined }, now: () => 240_000, relay: RELAY }).refreshList();
  assert.equal(without.find((r) => r.assetId === "nep141:eth.omft.near")!.logo, undefined, "control: no kept logos, a dead batch: the letter mark");
});

test("row 23: first open with the relay dead or slow and nothing kept: 1Click's own coins and prices, no error, no public API; retry after it answers fills the market", async () => {
  for (const busy of ["dead", "slow"] as const) {
    const { fetch, asked, state } = marketFake();
    state.busy = busy;
    let t = 0;
    const d = createNativeData({ fetch, storage: mem(), now: () => t, relay: RELAY, timeoutMs: 20 });
    const rows = await d.refreshList();
    assert.equal(rows.length, 5, `${busy}: every coin listed`);
    assert.equal(rows.find((r) => r.assetId === "nep141:wrap.near")!.price, 4, `${busy}: 1Click's own price`);
    assert.ok(!asked.some(isPublicMarket), `${busy}: never the keyless public API`);
    state.busy = undefined; t += 120_000;
    const later = await d.refreshList();
    assert.equal(later[0]!.symbol, "AURORA", `${busy}: retry after a failure: the market's ranking`);
    assert.ok(later.find((r) => r.assetId === "nep141:eth.omft.near")!.logo, `${busy}: and its logos`);
  }
});

test("row 23: offline (1Click unreachable too) with nothing kept is the list's one error; reload mid-load opens from the last answer at once, logos and all", async () => {
  const { fetch, state } = marketFake();
  state.oneclick = "dead"; state.busy = "dead";
  await assert.rejects(createNativeData({ fetch, storage: mem(), now: () => 0, relay: RELAY }).refreshList(), "nothing to show: the screen's own line (NATIVE_COPY.listDown)");
  const store = mem();
  const ok = marketFake();
  await createNativeData({ fetch: ok.fetch, storage: store, now: () => 0, relay: RELAY }).refreshList();
  // a reload: a new page, the same device; everything down now
  ok.state.oneclick = "dead"; ok.state.busy = "dead";
  const reloaded = createNativeData({ fetch: ok.fetch, storage: store, now: () => 1, relay: RELAY });
  const shown = reloaded.list();
  assert.ok(shown && shown.length === 5, "the last list at once, before any answer");
  assert.ok(shown!.find((r) => r.assetId === "nep141:eth.omft.near")!.logo, "with its logos");
  assert.equal((await reloaded.refreshList()).length, 5, "and a failed refresh keeps it");
});

test("row 23: no relay in the build: no market call at all (control: 1Click's list still loads)", async () => {
  const { fetch, asked } = marketFake();
  const rows = await createNativeData({ fetch, storage: null, now: () => 0 }).refreshList();
  assert.equal(rows.length, 5);
  assert.deepEqual(asked, ["https://1click.chaindefuser.com/v0/tokens"]);
});

test("rule 1: the list hides a coin without a working Buy and Sell (safeCanSell), never a dead 'Not yet'; its page still opens; control: no filter lists all", async () => {
  const store = mem();
  const { fetch, state } = marketFake();
  const d = createNativeData({ fetch, storage: store, now: () => 0, relay: RELAY, listed: safeCanSell });
  const rows = await d.refreshList();
  assert.deepEqual(rows.map((r) => r.assetId).sort(), ["nep141:base.omft.near", "nep141:eth.omft.near", "nep141:wrap.near"], "AURORA and TLO (the Safe can't sell them today) are not listed");
  assert.ok(rows.every((r) => safeCanSell(r.assetId)));
  assert.deepEqual(d.list()!.map((r) => r.assetId).sort(), rows.map((r) => r.assetId).sort(), "list() is the same shown list");
  assert.equal(d.coin("nep141:sol-abc.omft.near")?.symbol, "TLO", "a hidden coin's page still opens (a coin held)");
  // the market down after a reload: the kept list is filtered too
  state.busy = "dead";
  const again = await createNativeData({ fetch, storage: store, now: () => 1, relay: RELAY, listed: safeCanSell }).refreshList();
  assert.ok(again.length === 3 && again.every((r) => safeCanSell(r.assetId)), "the kept list, filtered");
  const all = await createNativeData({ fetch: marketFake().fetch, storage: null, now: () => 0, relay: RELAY }).refreshList();
  assert.equal(all.length, 5, "control: without the filter every coin 1Click lists is a row");
});

test("the copy review's asks: the Safe's NEAR reads NEAR (never Wrapped Near / wNEAR), its asset id unchanged; control: other coins keep their names", async () => {
  const rows = await createNativeData({ fetch: marketFake().fetch, storage: null, now: () => 0, relay: RELAY }).refreshList();
  const near = rows.find((r) => r.assetId === "nep141:wrap.near")!;
  assert.equal(near.symbol, "NEAR");
  assert.equal(near.name, "NEAR", "GeckoTerminal says 'Wrapped NEAR': not shown");
  assert.equal(rows.find((r) => r.assetId === "nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near")!.name, "Aurora", "control");
  assert.equal(rows.find((r) => r.assetId === "nep141:eth.omft.near")!.symbol, "ETH", "control");
});

test("the copy review's asks, rule 9a: the list says WHICH source failed (1Click's list, GeckoTerminal, CoinGecko, or ZeroFee's price server), and a good read clears it", async () => {
  const relayAnswer = (code: string, status: number) => new Response(JSON.stringify({ code }), { status });
  const cases: [string, (u: string) => Response | Promise<Response>, string, string][] = [
    ["GeckoTerminal busy", (u) => (u.includes("/gt/") ? relayAnswer("quotes.market.refused", 429) : new Response(JSON.stringify(MARKETS))), "gecko", "busy"],
    ["CoinGecko down", (u) => (u.includes("/cg/") ? relayAnswer("quotes.upstream.unreachable", 502) : new Response(JSON.stringify(u.includes("/eth/") ? GT_ETH : GT_NEAR))), "coingecko", "down"],
    ["our relay's own limit", () => relayAnswer("quotes.market.resting", 503), "relay", "down"],
    ["our relay unreachable", () => { throw new TypeError("Failed to fetch"); }, "relay", "down"],
  ];
  for (const [what, market, service, fault] of cases) {
    const fetch = (async (u: string) => (u.includes("v0/tokens") ? new Response(JSON.stringify(TOKENS)) : market(u))) as typeof globalThis.fetch;
    const d = createNativeData({ fetch, storage: null, now: () => 0, relay: RELAY });
    await d.refreshList();
    assert.deepEqual([d.fault()?.service, d.fault()?.fault], [service, fault], what);
  }
  // 1Click's own list unreachable: named first; the list read fails (nothing kept)
  const { fetch, state } = marketFake();
  state.oneclick = "dead";
  const d = createNativeData({ fetch, storage: null, now: () => 0, relay: RELAY });
  await assert.rejects(d.refreshList());
  assert.equal(d.fault()?.service, "oneclick");
  state.oneclick = undefined;
  await d.refreshList();
  assert.equal(d.fault(), null, "control: every source answered: no line");
});

test("the copy review's asks: Sell opens on All within the Face ID band, else the largest share under it, else the band; 'Pays from' is the Safe's USDC", () => {
  assert.deepEqual(sellStart(400, 500), { all: true }, "the whole holding fits");
  assert.deepEqual(sellStart(1280, 500), { all: false, usd: "320.00" }, "$1,280 vs $500: 25 % ($320); 50 % ($640) is over");
  assert.deepEqual(sellStart(900, 500), { all: false, usd: "450.00" }, "50 % fits");
  assert.deepEqual(sellStart(5000, 500), { all: false, usd: "500.00" }, "no share fits: the band itself");
  assert.deepEqual(sellStart(1280, null), { all: true }, "control: band not read: All (the core still checks)");
  assert.deepEqual(sellStart(1280, 0), { all: false, usd: "" }, "every move waits: nothing to start on");
  const rows = [{ tokenId: SAFE_CASH, amount: "2.05", held: "ledger" }, { tokenId: SAFE_CASH, amount: "9", held: "account" }, { tokenId: "nep141:wrap.near", amount: "3", held: "ledger" }];
  assert.equal(safeCashOf(rows), "2.05", "the USDC inside NEAR Intents, not the account's");
  assert.equal(safeCashOf([]), null, "control: none");
});

test("row 22: Trade's tabs are trenches | intents; the old names still open them; anything else is not a tab request", () => {
  for (const t of ["intents", "native", "near-intents"]) assert.equal(segOfRequest(t), "intents", t);
  for (const t of ["trenches", "memecoins", "meme"]) assert.equal(segOfRequest(t), "trenches", t);
  for (const t of [undefined, "", "trade", "market:sol", "Native"]) assert.equal(segOfRequest(t), undefined, String(t));
  assert.equal(NATIVE_COPY.trenches, "Trenches");
  assert.equal(NATIVE_COPY.intents, "NEAR Intents");
});

test("Sim re-check (5 Nov): a Buy says \"Job created.\" with its time left: the sheet is \"doing\" at the tap, and the core's answer marks it made (where the Safe's sheet is heard and no yes came first); control: a refused swap is never made", async () => {
  const f = fakeBridge({ swap: () => ({ ok: MOVE }), after: (emit) => emit({ ...MOVE, status: "done", amountOut: "6.2", settledMs: 900 }) });
  const views: SwapView[] = [];
  const run = runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "Buy $25.00 of NEAR", usd: "$25.00", quote: Q, tapMs: Date.now(), onView: (v) => views.push(v) });
  assert.deepEqual(views[0], { state: "doing" }, "in the tap's own frame: no await before it");
  await run;
  assert.ok(views.some((v) => v.state === "doing" && v.made), "made on the core's answer");
  assert.equal(views.at(-1)!.state, "done");
  const g = fakeBridge({ swap: () => ({ problem: { whatHappened: "Your Safe has too little USDC." } }) });
  const gv: SwapView[] = [];
  await runSwap({ bridge: g.bridge, tasks: g.tasks, taskId: "t", title: "x", usd: "$1.00", quote: Q, tapMs: Date.now(), onView: (v) => gv.push(v) });
  assert.ok(!gv.some((v) => v.made), "control");
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /setMade\(!sheetsHeard\("safe"\)\);/, "at the tap where no sheet of ours comes (the iPhone)");
  assert.match(page, /onOwnApproval\(\(yes\) => \{ if \(yes\) setMade\(true\); \}\)/, "on the Safe's own yes where it is heard");
  assert.match(page, /made && <>\n\s+<p className="zf-receipt__head" data-testid="native-job-created">\{JOB_WORDS\.created\}<\/p>\n\s+<TimeLeft etaSec=\{eta\} \/>/);
});
