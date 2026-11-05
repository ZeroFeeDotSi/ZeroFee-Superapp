// The on-chain spot price on wallet v1's recorded node answers (fixtures/v1-spot-raw.json: every call its spotPrice made on
// 21 Oct 2026, with GeckoTerminal's price of the same minute), with v1's own tests and numbers (market/spot.test.ts there):
// every pool type seen trending gives exactly v1's number, within 4 % of GeckoTerminal's (5 % for a fast PumpSwap coin),
// with no market data call at all; and v1's FETCHN case (a Pons v2 pool quoted in 0xEeee read 10^18 x too high once).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fx } from "./testing.ts";
import { spotPrice, type SpotEnv, type SpotPool } from "./spot.ts";

const FX = fx("v1-spot-raw") as { cases: { pool: SpotPool & { coin: { symbol: string } }; expectedUsd: number; spot: number; source: string; nativeUsd: number; rpc: { chain: string; method: string; params: unknown; result: unknown }[] }[] };
/** The recorded node: the very same call answers as it did; any other call is "not recorded". */
const envFor = (c: (typeof FX.cases)[number], missing: string[] = []): SpotEnv => ({
  nativeUsd: async () => c.nativeUsd,
  rpc: async (chain, method, params) => {
    const k = JSON.stringify([chain, method, params]);
    const hit = c.rpc.find((r) => JSON.stringify([r.chain, r.method, r.params]) === k);
    if (!hit) { missing.push(k.slice(0, 140)); throw new Error("not recorded"); }
    return hit.result;
  },
});

describe("spot price from the pool on chain (v1's 11 recorded cases)", () => {
  for (const c of FX.cases) {
    it(`${c.pool.coin.symbol} on ${c.pool.dex}: ${c.source}`, async () => {
      const missing: string[] = [];
      const s = await spotPrice(envFor(c, missing), c.pool.chain, c.pool.coin.address, c.pool);
      assert.ok(s, `no spot; not recorded: ${missing.join(" | ")}`);
      assert.equal(s.source, c.source);
      assert.ok(Math.abs(s.priceUsd / c.spot - 1) < 1e-9, `${s.priceUsd} vs v1's ${c.spot}`);
      assert.ok(Math.abs(s.priceUsd / c.expectedUsd - 1) < (c.pool.dex === "pumpswap" ? 0.05 : 0.04), `${s.priceUsd} vs GeckoTerminal ${c.expectedUsd}`);
    });
  }
  it("covers every pool type: v2, v3, Ramses, v4, Pons, Infinity, CLMM, CP-Swap, DLMM, PumpSwap", () => {
    const sources = new Set(FX.cases.map((c) => c.source.replace(/ \(approx\)/, "")));
    for (const s of ["getReserves", "slot0", "v4 extsload", "Infinity getSlot0", "CLMM sqrt price", "CPMM vaults", "DLMM active bin", "PumpSwap last swap"]) assert.ok(sources.has(s), s);
  });
  it("a node that fails is no price, never a wrong one", async () => {
    const c = FX.cases.find((x) => x.source === "slot0")!;
    assert.equal(await spotPrice({ nativeUsd: async () => 1, rpc: async () => { throw new Error("down"); } }, c.pool.chain, c.pool.coin.address, c.pool), undefined);
  });
  it("a quote with no dollar price (neither stable, native nor a snapshot) gives no price", async () => {
    const c = FX.cases.find((x) => x.source === "getReserves")!;
    const pool = { ...c.pool, quote: { ...c.pool.quote, kind: undefined, priceUsd: undefined, address: "0x" + "99".repeat(20) } } as SpotPool;
    assert.equal(await spotPrice(envFor(c), pool.chain, pool.coin.address, pool), undefined);
  });
});

describe("the 0xEeee native sentinel (v1: FETCHN on Pons v2 read $145,989,877,618 for a $0.0000417 coin)", () => {
  // the getReserves word is the real answer of 0x19c3…7772 on 21 Oct (reserve0 = 5.31 ETH, reserve1 = 316 M FETCHN)
  const RES = "0x00000000000000000000000000000000000000000000000049c2de21e064d73300000000000000000000000000000000000000000105753d938ab8b0aa911e1f";
  const env: SpotEnv = { nativeUsd: async () => 2453.56, rpc: async (_c, m, p: any) => {
    if (m !== "eth_call") throw new Error(m);
    const { to, data } = p[0];
    if (to === "0x19c3201e252b1466b4b0c252a5a526f91bab7772" && data === "0x0902f1ac") return RES;
    if (data === "0x313ce567") return "0x";                                              // no contract at 0xEeee (or 0x1111): an empty answer
    throw new Error("execution reverted");
  } };
  const pool = (quote: string, decimals?: number): SpotPool => ({ chain: "hood", pool: "0x19c3201e252b1466b4b0c252a5a526f91bab7772", dex: "pons-v2", coin: { address: "0x16c93795477fab5730a00889e042d5815be90bfc", decimals: 18 }, quote: { address: quote, priceUsd: 2453.56, ...(decimals !== undefined ? { decimals } : {}) } });
  it("a pool quoted in 0xEeee is priced as the native coin (18 decimals, the lower token): $0.0000412, not $1.46e29", async () => {
    const s = await spotPrice(env, "hood", "0x16c93795477fab5730a00889e042d5815be90bfc", pool("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"));
    assert.ok(s);
    assert.ok(s.priceUsd / 0.0000416716 > 0.9 && s.priceUsd / 0.0000416716 < 1.1, `${s.priceUsd}`);
  });
  it("an empty decimals() answer is no price, never 0 decimals", async () => {
    assert.equal(await spotPrice(env, "hood", "0x16c93795477fab5730a00889e042d5815be90bfc", pool("0x1111111111111111111111111111111111111111")), undefined);
  });
});

describe("the market: a coin page and its live price when GeckoTerminal can't be asked (v1: 'a coin page at $0.00 when GeckoTerminal answered 429')", () => {
  // CARDS / USDC on Raydium CLMM, as GeckoTerminal ranked it on 21 Oct (v1's capture), and v1's recorded read of that pool
  const cards = FX.cases.find((c) => c.pool.dex === "raydium-clmm")!;
  const CARDS = cards.pool.coin.address;
  const solRpc = async (method: string, params: unknown[]) => {
    if (method === "getMultipleAccounts") return { value: (params[0] as string[]).map(() => null) };   // the chain can't name it here: the list's row stands
    return envFor(cards).rpc("sol", method, params);
  };
  const trending = fx("v1-trending-solana");
  it("its page opens from the list's row, priced by its pool on chain (v1's number), not 'busy'", async () => {
    const { createMarket } = await import("./index.ts");
    const { replay, status } = await import("./testing.ts");
    const r = replay([["networks/solana/trending_pools", trending], [`tokens/${CARDS}`, status(429)], ["api.coingecko.com", { solana: { usd: 105.96 } }]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, solRpc });
    const rows = await m.trending("sol");
    assert.ok(rows.some((x) => x.address === CARDS), "CARDS is in the list");
    const d = await m.coin("sol", CARDS);
    assert.equal(d.fromChain, true);
    assert.equal(d.symbol, "CARDS");
    assert.ok(Math.abs(d.priceUsd! / cards.spot - 1) < 1e-9, `${d.priceUsd} vs v1's ${cards.spot}`);
  });
  it("without a node to ask, the list's row and its price (the market data's, from the list)", async () => {
    const { createMarket } = await import("./index.ts");
    const { replay, status } = await import("./testing.ts");
    const r = replay([["networks/solana/trending_pools", trending], [`tokens/${CARDS}`, status(429)]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0 });
    const row = (await m.trending("sol")).find((x) => x.address === CARDS)!;
    const d = await m.coin("sol", CARDS);
    assert.equal(d.priceUsd, row.priceUsd);
  });
  it("its live price: the pool's spot price when GeckoTerminal's poll fails", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((res) => setImmediate(res)); };
    const { createMarket } = await import("./index.ts");
    const { replay, status } = await import("./testing.ts");
    const r = replay([["networks/solana/trending_pools", trending], ["token_price", status(500)]]);
    const m = createMarket({ fetch: r.fetch, now: r.now, storage: null, screenWaitMs: 0, livePollMs: 200, solRpc });
    const listed = m.trending("sol"); await flush(); await listed;
    const got: number[] = [];
    const u = m.livePrice("sol", CARDS, (p) => got.push(p));
    t.mock.timers.tick(60); await flush();
    u();
    assert.equal(got.length, 1);
    assert.ok(Math.abs(got[0]! / cards.spot - 1) < 1e-9);
  });
});
