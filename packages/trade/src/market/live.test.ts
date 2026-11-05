// A coin's swaps from the chain (live.ts) on wallet v1's real captures: its recent swaps with v1's own two cases and numbers
// (market/live/recent.test.ts there: Pancake v3 AGT / WBNB from eth_getLogs, PumpSwap PUMP / USDC from signatures and
// transactions), the polling follower (the first round only marks where the chain is; each swap once; a stop is final),
// the chart's minute candles, and the market using both for a coin the market data has no chart or fresh price for.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fx, type TestSocket } from "./testing.ts";
import { candlesOfTicks, followSwaps, recentSwaps, type Tick } from "./live.ts";
import type { SpotEnv, SpotPool } from "./spot.ts";

const EVM = fx("v1-live-evm"), SOL = fx("v1-live-sol");
const raw = (c: any) => ({ slot: c.tx.slot, blockTime: c.tx.blockTime, transaction: { message: { accountKeys: c.tx.keys } }, meta: { err: c.tx.err, preTokenBalances: c.tx.pre, postTokenBalances: c.tx.post, logMessages: c.logs } });
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise<void>((res) => setImmediate(res)); };

// Pancake v3 AGT / WBNB: v1's captured swap logs, given block numbers 5 apart and block times one second per block
const agt = EVM.cases.filter((c: any) => c.name === "pancakeV3_AGT_WBNB");
const agtPool: SpotPool = { chain: "bsc", pool: agt[0].poolId, dex: "pancakeswap-v3-bsc", coin: { address: agt[0].coin.address, decimals: agt[0].coin.decimals }, quote: { address: agt[0].quote.address, decimals: agt[0].quote.decimals, kind: "native" } };
const agtLogs = agt.map((c: any, i: number) => ({ ...c.log, blockNumber: "0x" + (1000 + i * 5).toString(16) }));
const evmEnv = (logsOf: (from: number, to: number) => unknown[], head: () => number, log: string[] = []): SpotEnv => ({
  nativeUsd: async () => 700,
  rpc: async (_c, method, params: any[]) => {
    log.push(method);
    if (method === "eth_blockNumber") return "0x" + head().toString(16);
    if (method === "eth_getLogs") return logsOf(parseInt(params[0].fromBlock, 16), parseInt(params[0].toBlock, 16));
    if (method === "eth_getBlockByNumber") return { timestamp: "0x" + (1_790_000_000 + (parseInt(params[0], 16) - 1000)).toString(16) };
    throw new Error("unexpected " + method);
  },
});

// PumpSwap PUMP / USDC: v1's captured transactions, and a failed one the node lists first
const PUMP_POOL = SOL.pools.pumpswap_PUMP_USDC;
const pumpCases = SOL.cases.filter((c: any) => c.name === "pumpswap_PUMP_USDC");
const trending = fx("v1-trending-solana");
const pumpRow = trending.data.find((p: any) => p.attributes.address === PUMP_POOL);
const PUMP = pumpRow.relationships.base_token.data.id.replace("solana_", "");
const pumpPool: SpotPool = { chain: "sol", pool: PUMP_POOL, dex: "pumpswap", coin: { address: PUMP, decimals: 6 }, quote: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, kind: "stable" } };
const solEnv = (sigs: (opts: any) => unknown[], log: string[] = []): SpotEnv => ({
  nativeUsd: async () => 150,
  rpc: async (_c, method, params: any[]) => {
    log.push(method === "getTransaction" ? `tx:${String(params[0]).slice(0, 6)}` : method);
    if (method === "getAccountInfo") return params[0] === PUMP_POOL ? { value: { owner: SOL.accounts[PUMP_POOL].owner, data: [SOL.accounts[PUMP_POOL].data, "base64"] } } : { value: { data: { parsed: { info: { decimals: 6 } } } } };
    if (method === "getSignaturesForAddress") return sigs(params[1]);
    if (method === "getTransaction") { const c = pumpCases.find((x: any) => x.sig === params[0]); if (!c) throw new Error("a failed transaction must not be read"); return raw(c); }
    throw new Error("unexpected " + method);
  },
});

describe("recent swaps (v1's two cases)", () => {
  it("BNB Chain, Pancake v3: from eth_getLogs, the blocks' own times, oldest first, priced in BNB", async () => {
    assert.ok(agt.length >= 2);
    const r = await recentSwaps(evmEnv(() => agtLogs, () => 0x400), "bsc", agtPool.coin.address, agtPool, 10);
    assert.equal(r.length, agt.length);
    for (let i = 1; i < r.length; i++) assert.ok(r[i]!.t >= r[i - 1]!.t);
    assert.equal(r[0]!.t, 1_790_000_000 * 1000);
    for (const t of r) { assert.ok(t.priceUsd > 0 && t.usd > 0); assert.ok(["buy", "sell"].includes(t.side)); assert.match(t.tx!, /^0x/); }
    // AGT's price at $700 a BNB: about $0.06 at the capture
    assert.ok(r[0]!.priceUsd > 0.03 && r[0]!.priceUsd < 0.12, `${r[0]!.priceUsd}`);
  });
  it("Solana, PumpSwap: signatures, then transactions, through the same decoders; a failed transaction is never read; the block's time", async () => {
    assert.ok(pumpCases.length >= 2);
    const log: string[] = [];
    const sigs = () => [{ signature: "FAILEDSIG", err: { InstructionError: [0, "x"] }, blockTime: 1 }, ...pumpCases.map((c: any) => ({ signature: c.sig, err: null, blockTime: c.tx.blockTime }))];
    const r = await recentSwaps(solEnv(sigs, log), "sol", PUMP, pumpPool, 20);
    assert.ok(r.length >= 2);
    for (const t of r) { assert.ok(t.t > 1.7e12); assert.ok(t.priceUsd > 0.003 && t.priceUsd < 0.007, `${t.priceUsd}`); assert.notEqual(t.tx, "FAILEDSIG"); }
    for (let i = 1; i < r.length; i++) assert.ok(r[i]!.t >= r[i - 1]!.t);
    assert.ok(!log.includes("tx:FAILED"));
  });
  it("a pool type no decoder reads, or a quote with no dollar price, is no swaps, not an error", async () => {
    assert.deepEqual(await recentSwaps(evmEnv(() => agtLogs, () => 0x400), "bsc", agtPool.coin.address, { ...agtPool, pool: "not-a-pool" }), []);
    assert.deepEqual(await recentSwaps(evmEnv(() => agtLogs, () => 0x400), "bsc", agtPool.coin.address, { ...agtPool, quote: { address: "0x" + "99".repeat(20), decimals: 18 } }), []);
  });
});

describe("following a pool by polling the nodes", () => {
  it("EVM: the first round marks the head; then each round's new swaps, each once, from the block after the last one seen", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let head = 1000;
    const asked: [number, number][] = [];
    const env = evmEnv((from, to) => { asked.push([from, to]); return agtLogs.filter((l: any) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to); }, () => head);
    const got: Tick[] = [];
    const stop = followSwaps(env, "bsc", agtPool.coin.address, agtPool, (x) => got.push(x), { pollMs: 2000, now: () => 5 });
    await flush();
    assert.deepEqual([got.length, asked.length], [0, 0], "no history on the first round");
    head = 1000 + 5 * (agt.length - 1);
    t.mock.timers.tick(2000); await flush();
    assert.equal(got.length, agt.length - 1, "the swaps after block 1000");
    assert.deepEqual(asked[0], [1001, head]);
    t.mock.timers.tick(2000); await flush();
    assert.equal(got.length, agt.length - 1, "nothing new: nothing again");
    assert.equal(asked.length, 1, "a head with no new block asks for no logs");
    assert.equal(got[0]!.t, 5, "a live swap's time is its arrival");
    stop();
    head += 100;
    t.mock.timers.tick(10_000); await flush();
    assert.equal(asked.length, 1, "a stop is final");
  });
  it("Solana: the first round marks the newest signature; then the transactions after it, the newest 2 a round, oldest first", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let newer: any[] = [];
    const untils: (string | undefined)[] = [];
    const log: string[] = [];
    const env = solEnv((o) => { untils.push(o.until); return o.until ? newer : [{ signature: "OLD", err: null }]; }, log);
    const got: Tick[] = [];
    const stop = followSwaps(env, "sol", PUMP, pumpPool, (x) => got.push(x), { pollMs: 2000 });
    await flush();
    assert.equal(got.length, 0);
    // the node lists the newest first: the two captured swaps, then two older transactions that must not be read
    newer = [...pumpCases.map((c: any) => ({ signature: c.sig, err: null })).reverse(), { signature: "OLDER1", err: null }, { signature: "OLDER2", err: null }];
    t.mock.timers.tick(3000); await flush();
    assert.equal(untils[1], "OLD", "asked for what came after the marked signature");
    assert.ok(got.length >= 1 && got.length <= 2 * 2, `${got.length}`);
    assert.equal(untils.length, 2);
    assert.deepEqual(log.filter((l) => l.startsWith("tx:")).length, 2, "the newest two of the new transactions, no more");
    assert.ok(!log.some((l) => l.startsWith("tx:OLDER")));
    assert.ok(got.every((x) => x.priceUsd > 0.003 && x.priceUsd < 0.007));
    stop();
  });
  it("paused (the page is hidden): no node is asked", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const log: string[] = [];
    const stop = followSwaps(evmEnv(() => [], () => 1000, log), "bsc", agtPool.coin.address, agtPool, () => {}, { pollMs: 2000, paused: () => true });
    await flush(); t.mock.timers.tick(6000); await flush();
    assert.ok(!log.includes("eth_getLogs") && !log.includes("eth_blockNumber"));
    stop();
  });
});

describe("the chart's minute candles from swaps", () => {
  it("a candle a minute: open at the last close, high, low, close, volume in dollars", () => {
    const c = candlesOfTicks([{ t: 60_500, priceUsd: 2, side: "buy", usd: 10 }, { t: 61_000, priceUsd: 3, side: "buy", usd: 5 }, { t: 1_000, priceUsd: 1, side: "sell", usd: 1 }, { t: 125_000, priceUsd: 2.5, side: "sell", usd: 2 }]);
    assert.deepEqual(c, [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 60_000, o: 1, h: 3, l: 1, c: 3, v: 15 }, { t: 120_000, o: 3, h: 3, l: 2.5, c: 2.5, v: 2 }]);
  });
});

describe("the market: a chart and a live price from the chain", () => {
  it("a coin the market data has no candles for (its candles can't be had) is drawn from its pool's recent swaps", async () => {
    const { createMarket } = await import("./index.ts");
    const { replay, status } = await import("./testing.ts");
    const sigs = () => pumpCases.map((c: any) => ({ signature: c.sig, err: null, blockTime: c.tx.blockTime }));
    const env = solEnv(sigs);
    const r = replay([["networks/solana/trending_pools", trending], ["/ohlcv/", status(500)], [`tokens/${PUMP}`, status(429)]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, solRpc: (method, params) => env.rpc("sol", method, params) });
    await m.trending("sol");
    const c = await m.candles("sol", PUMP, "1H");
    assert.ok(c.length >= 1);
    assert.ok(c.every((x) => x.c > 0.003 && x.c < 0.007 && x.v > 0));
    assert.equal(c.fromChain, true, "marked (audit 2 Nov): the page says it's the last few minutes, not the range's chart");
  });
  it("without a node to ask, the market data's failure stands", async () => {
    const { createMarket, MarketError } = await import("./index.ts");
    const { replay, status } = await import("./testing.ts");
    const r = replay([["networks/solana/trending_pools", trending], ["/ohlcv/", status(500)], [`tokens/${PUMP}`, status(429)]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0 });
    await m.trending("sol");
    await assert.rejects(m.candles("sol", PUMP, "1H"), MarketError);
  });
  it("the open coin's live price comes from its pool's swaps on chain, and the market data's slower poll doesn't step on it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { createMarket } = await import("./index.ts");
    const { replay } = await import("./testing.ts");
    let newer: any[] = [];
    const env = solEnv((o) => (o.until ? newer : [{ signature: "OLD", err: null }]));
    const gtPrice = 0.00999;
    const r = replay([["networks/solana/trending_pools", trending], ["token_price", () => ({ data: { attributes: { token_prices: { [PUMP]: String(gtPrice) } } } })]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, livePollMs: 15_000, chainPollMs: 2_000, solRpc: (method, params) => env.rpc("sol", method, params) });
    const listed = m.trending("sol"); await flush(); await listed;
    const got: number[] = [];
    const u = m.livePrice("sol", PUMP, (p) => got.push(p));
    t.mock.timers.tick(60); await flush();                              // the market data's first reading
    assert.deepEqual(got, [gtPrice]);
    newer = pumpCases.map((c: any) => ({ signature: c.sig, err: null })).reverse();
    t.mock.timers.tick(2000); await flush(); t.mock.timers.tick(2000); await flush();
    const fromChain = got.slice(1);
    assert.ok(fromChain.length >= 1 && fromChain.every((p) => p > 0.003 && p < 0.007), `${got}`);
    t.mock.timers.tick(15_000); await flush();                          // the poll's next reading: the chain's is fresher
    assert.ok(!got.slice(1 + fromChain.length).includes(gtPrice), `${got}`);
    u();
  });

  it("each swap the follower sees reaches Latest trades as it lands (liveTrades), once each; nothing before a price is watched", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { createMarket } = await import("./index.ts");
    const { replay } = await import("./testing.ts");
    let newer: any[] = [];
    const env = solEnv((o) => (o.until ? newer : [{ signature: "OLD", err: null }]));
    const r = replay([["networks/solana/trending_pools", trending], ["token_price", () => ({ data: { attributes: { token_prices: { [PUMP]: "0.005" } } } })]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, livePollMs: 15_000, chainPollMs: 2_000, solRpc: (method, params) => env.rpc("sol", method, params) });
    const listed = m.trending("sol"); await flush(); await listed;
    const got: Tick[] = [];
    const offT = m.liveTrades!("sol", PUMP, (x) => got.push(x));
    const offP = m.livePrice("sol", PUMP, () => {});
    t.mock.timers.tick(60); await flush();
    assert.deepEqual(got, [], "the market data's price is no trade");
    newer = pumpCases.map((c: any) => ({ signature: c.sig, err: null })).reverse();
    t.mock.timers.tick(2000); await flush(); t.mock.timers.tick(2000); await flush(); t.mock.timers.tick(2000); await flush();
    assert.ok(got.length >= 1, "the chain's swaps, as they land");
    assert.ok(got.every((x) => x.tx && x.usd > 0 && (x.side === "buy" || x.side === "sell") && !x.unconfirmed), JSON.stringify(got));
    assert.equal(new Set(got.map((x) => x.tx)).size, got.length, "each once");
    offT(); offP();
  });

  it("how the price reaches us: over the chain's socket it says live; with no socket, or no follower, polling (the coin page's \"Slower updates\")", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { createMarket } = await import("./index.ts");
    const { replay, socketMaker } = await import("./testing.ts");
    const env = solEnv(() => [{ signature: "OLD", err: null }]);
    const r = replay([["networks/solana/trending_pools", trending], ["token_price", () => ({ data: { attributes: { token_prices: { [PUMP]: "0.005" } } } })]]);
    const socks: TestSocket[] = [];
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, chainPollMs: 3_000, solRpc: (method, params) => env.rpc("sol", method, params), ws: socketMaker(socks) as never });
    const listed = m.trending("sol"); await flush(); await listed;
    const states: string[] = [];
    const u = m.livePrice("sol", PUMP, () => {}, (s) => states.push(s.state));
    assert.equal(states[0], "polling", "told at once: nothing live yet");
    await flush();
    assert.ok(socks.length >= 1, "the coin's pool is followed over the chain's socket");
    const s0 = socks[0]!;
    s0.accept(); s0.confirm(); s0.push(s0.idFor((x) => x.method === "slotSubscribe"), { slot: 1 }, "slotNotification"); await flush();
    assert.equal(states.at(-1), "live", states.join(" → "));
    u();
    // a market with no node reader has no follower: polling, and that's all
    const plain = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0 });
    await plain.trending("sol");
    const only: string[] = [];
    const u2 = plain.livePrice("sol", PUMP, () => {}, (s) => only.push(s.state));
    t.mock.timers.tick(30_000); await flush();
    assert.deepEqual(only, ["polling"]);
    u2();
  });
});
