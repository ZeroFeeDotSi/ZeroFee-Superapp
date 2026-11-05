// The market module on real answers captured read-only on 25 Oct 2026 (fixtures/), replayed offline: search, trending, a coin page, candles,
// the engines' fast meta(), native prices, live prices, and the call budget under a busy Discover screen.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMarket, MarketError } from "./index.ts";
import { GT_BURST, GT_BUDGET } from "./gt.ts";
import { fx, replay, status, type Replay } from "./testing.ts";
import type { ChainId } from "../types.ts";

const DOPE = "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump";
const SEASON = "0xea0071a8778fa02c12378e88868255e0e0952be6";
const IRYS = "0x91152b4ef635403efbae860edd0f8c321d7c035d";
const WSOL = "So11111111111111111111111111111111111111112";

/** Every captured answer, routed the way GeckoTerminal's paths look. */
function routes(extra: [string, unknown | ((u: string) => unknown)][] = []): [string, unknown | ((u: string) => unknown)][] {
  return [
    ...extra,
    ["api.coingecko.com", fx("cg-simple-price")],
    ["networks/solana/trending_pools", fx("trending-solana")], ["networks/bsc/trending_pools", fx("trending-bsc")], ["networks/robinhood/trending_pools", fx("trending-robinhood")],
    ["networks/near/trending_pools", fx("trending-near")],
    ["networks/trending_pools", fx("trending-all")],
    [`networks/solana/tokens/${DOPE}/info`, fx("info-sol")], [`networks/solana/tokens/${DOPE}?`, fx("token-sol")],
    [`networks/robinhood/tokens/${SEASON}/info`, fx("info-hood")], [`networks/robinhood/tokens/${SEASON}?`, fx("token-hood")],
    [`networks/bsc/tokens/${IRYS}/info`, fx("info-bsc")], [`networks/bsc/tokens/${IRYS}?`, fx("token-bsc")],
    ["search/pools", (u: string) => fx(u.includes("network=solana") ? "search-sol" : u.includes("network=bsc") ? "search-bsc" : u.includes("network=robinhood") ? "search-hood" : "search-all")],
    ["/ohlcv/minute", fx("ohlcv-minute-sol")], ["/ohlcv/hour", fx("ohlcv-hour-sol")], ["/ohlcv/day", fx("ohlcv-hour-sol")],
    ["simple/networks/solana/token_price", fx("price-sol")],
  ];
}
// a virtual clock never waits for room in the budget (the test that waits moves the clock itself)
/** The replay's clock three years on: the fixture's coin (first pool 11 Oct 2026) is older than every range. */
const aged = (r: Replay) => () => r.now() + 3 * 365 * 86_400_000;
const mk = (r: Replay, o: Parameters<typeof createMarket>[0] = {}) => createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0, ...o });
const poolOrder = (name: string): string[] => fx(name).data.map((p: any) => p.relationships.base_token.data.id.replace(/^[a-z]+_/, ""));

describe("trending is GeckoTerminal's own list in its own order", () => {
  for (const [chain, file] of [["sol", "trending-solana"], ["bsc", "trending-bsc"], ["hood", "trending-robinhood"]] as [ChainId, string][]) {
    it(`${chain}: one call, rows in the fixture's order, no native or stable as a coin, every address a real token address`, async () => {
      const r = replay(routes());
      const rows = await mk(r).trending(chain);
      assert.equal(r.calls.length, 1);
      assert.ok(rows.length >= 8, `${rows.length} rows`);
      const order = fx(file).data.map((p: any) => p.attributes.address);
      assert.ok(order.length >= rows.length);
      // order check: positions of the rows' base tokens in GeckoTerminal's list are increasing
      const base = poolOrder(file).map((a: string) => a.toLowerCase());
      let last = -1;
      for (const row of rows) { const i = base.indexOf(row.address.toLowerCase(), last + 1); assert.ok(i > last, `${row.symbol} is out of GeckoTerminal's order`); last = i; }
      for (const row of rows) {
        assert.equal(row.chain, chain);
        assert.ok(row.priceUsd! > 0);
        assert.ok(row.logoUrl === undefined || /^https:\/\//.test(row.logoUrl));
        assert.doesNotMatch(row.symbol, /^(SOL|USDC|USDT|WETH|WBNB|USDG)$/);
      }
    });
  }
  it("Solana's first row is DOPE with its logo, price, 24 h change, liquidity, volume and market cap", async () => {
    const rows = await mk(replay(routes())).trending("sol");
    const d = rows[0]!;
    assert.equal(d.address, DOPE);
    assert.equal(d.symbol, "DOPE");
    assert.equal(d.name, "Doge Pepe");
    assert.match(d.logoUrl!, /^https:\/\/coin-images\.coingecko\.com\//);
    assert.ok(Math.abs(d.priceUsd! - 0.00332) < 0.0001);
    assert.equal(d.change24hPct, 4.062);
    assert.ok(Math.abs(d.liquidityUsd! - 240216.9049) < 1e-6);
    assert.ok(d.volume24hUsd! > 800_000);
    assert.ok(Math.abs(d.marketCapUsd! - 3247203.52755355) < 1e-6);
  });
  it("with no chain: GeckoTerminal's cross-network list is used when it covers our chains well; here BNB Chain has only 2 of 20, so the chains are alternated, and only a short chain asks for its own list", async () => {
    const r = replay(routes());
    const rows = await mk(r).trending();
    assert.equal(r.count("networks/trending_pools"), 1, "the cross-network list once");
    const mine = (n: string) => r.count(`networks/${n}/trending_pools`);
    assert.equal(mine("bsc"), 1, "BNB Chain, short in it, asks for its own");
    // NEAR (TN1) isn't in this captured cross-network list at all: it asks for its own too
    assert.equal(mine("near"), 1, "NEAR, absent from it, asks for its own");
    assert.equal(r.calls.length, 1 + mine("solana") + mine("bsc") + mine("robinhood") + mine("near"));
    assert.ok(r.calls.length < 5, `${r.calls.length} calls: a chain the cross-network list covers isn't asked again`);
    assert.deepEqual(rows.slice(0, 3).map((x) => x.chain), ["sol", "hood", "bsc"]);
    assert.equal(new Set(rows.map((x) => `${x.chain}:${x.address}`)).size, rows.length, "a coin once");
  });
  it("with no chain, a cross-network list that covers every chain is returned as GeckoTerminal ranks it, in one call", async () => {
    const all = fx("trending-all");
    // make a list with 4 pools of each of our chains (taken from the captured per-chain lists), in a fixed interleaved order
    const take = (f: string, n: number) => fx(f).data.filter((p: any) => !/SOL|USDC|WETH|WBNB|USDT|USDG/.test(p.attributes.name.split(" / ")[0])).slice(0, n);
    // four NEAR coins, one pool each (QTC, ZEC and RHEA trend in more than one)
    const nearCoins = fx("trending-near").data.filter((p: any, i: number, all: any[]) => /^(QTC|ZEC|RHEA|NEARLY) /.test(p.attributes.name) && all.findIndex((q: any) => q.attributes.name.split(" ")[0] === p.attributes.name.split(" ")[0]) === i);
    const data = [...take("trending-solana", 4), ...take("trending-bsc", 4), ...take("trending-robinhood", 4), ...nearCoins].sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
    const included = [...fx("trending-solana").included, ...fx("trending-bsc").included, ...fx("trending-robinhood").included, ...fx("trending-near").included];
    const r = replay([["networks/trending_pools", { ...all, data, included }], ...routes()]);
    const rows = await mk(r).trending();
    assert.equal(r.calls.length, 1);
    assert.deepEqual(rows.map((x) => x.address.toLowerCase()), data.map((p: any) => p.relationships.base_token.data.id.replace(/^[a-z]+_/, "").toLowerCase()).filter((a: string) => rows.some((x) => x.address.toLowerCase() === a)));
  });
  it("the spam filter hides a copy of a famous coin and a dust pool from trending, and shows everything else", async () => {
    const t = fx("trending-bsc");
    const fake = JSON.parse(JSON.stringify(t));
    const tok = fake.included.find((i: any) => i.type === "token" && i.id === fake.data[1].relationships.base_token.data.id);
    tok.attributes.symbol = "USDT"; tok.attributes.name = "Tether USD";
    fake.data[2].attributes.reserve_in_usd = "150";
    const rows = await mk(replay([["networks/bsc/trending_pools", fake], ...routes()])).trending("bsc");
    const ids = rows.map((x) => x.address.toLowerCase());
    assert.ok(!ids.includes(fake.data[1].relationships.base_token.data.id.replace("bsc_", "")));
    assert.ok(!ids.includes(fake.data[2].relationships.base_token.data.id.replace("bsc_", "")));
    const plain = await mk(replay(routes())).trending("bsc");
    assert.equal(rows.length, plain.length - 2);
  });
  it("a coin the person bought is kept whatever the filter says", async () => {
    const t = JSON.parse(JSON.stringify(fx("trending-bsc")));
    t.data[2].attributes.reserve_in_usd = "150";
    const addr = t.data[2].relationships.base_token.data.id.replace("bsc_", "");
    const hidden = await mk(replay([["networks/bsc/trending_pools", t], ...routes()])).trending("bsc");
    const kept = await mk(replay([["networks/bsc/trending_pools", t], ...routes()]), { keep: (c, a) => c === "bsc" && a.toLowerCase() === addr }).trending("bsc");
    assert.ok(!hidden.some((x) => x.address.toLowerCase() === addr));
    assert.ok(kept.some((x) => x.address.toLowerCase() === addr));
  });
});

describe("search", () => {
  it("a name: ONE call across the networks; a chain it leaves thin is asked for itself; merged fairly, dust under $1,000 left out, a coin once, at most 30", async () => {
    const r = replay(routes());
    const rows = await mk(r).search("pepe");
    assert.match(r.calls[0]!.url, /search\/pools\?query=pepe&include=/);
    assert.ok(!r.calls[0]!.url.includes("network="));
    const thin = r.calls.slice(1);
    assert.ok(thin.length >= 1 && thin.length <= 3, `${thin.length} top-ups`);
    assert.ok(thin.every((c) => /network=(bsc|robinhood|near)/.test(c.url)), "Solana was not thin");
    assert.ok(rows.length > 3 && rows.length <= 30);
    // best first (rankSearch): the coins whose ticker is "PEPE" before the rest, each group by the money in its market,
    // never one chain then another
    const exact = (x: typeof rows[number]) => x.symbol.replace(/^\$+/, "").toUpperCase() === "PEPE";
    const firstOther = rows.findIndex((x) => !exact(x));
    assert.ok(firstOther === -1 || rows.slice(firstOther).every((x) => !exact(x)), "every PEPE before every other coin");
    for (let i = 1; i < rows.length; i++) if (exact(rows[i - 1]!) === exact(rows[i]!)) assert.ok((rows[i - 1]!.liquidityUsd ?? 0) >= (rows[i]!.liquidityUsd ?? 0), `row ${i} deeper than the one before it`);
    assert.equal(new Set(rows.map((x) => x.chain)).size > 1, true, "every chain still has its coins in the list");
    assert.ok(rows.every((x) => x.liquidityUsd! >= 1_000));
    assert.equal(new Set(rows.map((x) => `${x.chain}:${x.address}`)).size, rows.length);
  });
  it("when the budget has little room left, the per-chain top-up is skipped and the global rows are still returned", async () => {
    const r = replay(routes());
    const m = mk(r, { budget: { calls: 4, perMs: 60_000 } });                // after the search, 3 calls left: under SEARCH_TOPUP_ROOM
    const rows = await m.search("pepe");
    assert.equal(r.calls.length, 1);
    assert.ok(rows.length > 5);
  });
  it("a query shorter than 2 characters asks nothing", async () => {
    const r = replay(routes());
    assert.deepEqual(await mk(r).search(" a "), []);
    assert.equal(r.calls.length, 0);
  });
  it("the same search twice inside a minute costs nothing the second time", async () => {
    const r = replay(routes());
    const m = mk(r);
    await m.search("pepe"); const n = r.calls.length; await m.search("pepe");
    assert.equal(r.calls.length, n);
  });
  it("a top-up failing does not blank the rest; the main search failing is an error", async () => {
    const r = replay([["network=", status(500)], ...routes()]);
    const rows = await mk(r).search("pepe");
    assert.ok(rows.some((x) => x.chain === "sol"));
    const dead = replay([["search/pools", status(500)]]);
    await assert.rejects(mk(dead).search("pepe"), (e: unknown) => e instanceof MarketError);
  });
  it("a pasted Solana address is one call and shows the coin whatever its liquidity", async () => {
    const r = replay(routes());
    const rows = await mk(r).search(` ${DOPE} `);
    assert.equal(r.calls.length, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.symbol, "DOPE");
    assert.ok(rows[0]!.liquidityUsd! > 100_000);
    assert.ok(rows[0]!.marketCapUsd! > 3_000_000);
    // a dust coin is still shown when pasted
    const dust = JSON.parse(JSON.stringify(fx("token-sol"))); dust.data.attributes.total_reserve_in_usd = "12";
    const rr = replay([[`tokens/${DOPE}`, dust]]);
    assert.equal((await mk(rr).search(DOPE))[0]!.liquidityUsd, 12);
  });
  it("a pasted 0x address is asked on BNB Chain and Robinhood Chain at once; the chain that has it answers, the other's 404 is just 'not here'", async () => {
    const r = replay(routes());
    const rows = await mk(r).search(SEASON.toUpperCase().replace("0X", "0x"));
    assert.equal(r.calls.length, 2);
    assert.deepEqual(rows.map((x) => [x.chain, x.symbol]), [["hood", "SEASON"]]);
    assert.equal(rows[0]!.address, SEASON, "EVM addresses come back lower-case");
  });
  it("a pasted address nobody knows is an empty list; a network failure is an error, not 'no such coin'", async () => {
    assert.deepEqual(await mk(replay([])).search(DOPE), []);
    await assert.rejects(mk(replay([["tokens/", status(500)]])).search(DOPE), MarketError);
  });
  it("a pasted address then makes the coin's meta() instant and complete (pools with dex ids)", async () => {
    const r = replay(routes());
    const m = mk(r);
    await m.search(DOPE);
    const n = r.calls.length;
    const meta = await m.meta("sol", DOPE);
    assert.equal(r.calls.length, n);
    assert.equal(meta?.pools?.length, 3);
  });
});

describe("coin(): CoinMeta plus what the page shows", () => {
  it("Solana: pools with GeckoTerminal's own dex ids, deepest first; total liquidity; 24 h change of the main pool; decimals; holders; the authorities; the last minute's move", async () => {
    const r = replay(routes());
    const m = mk(r);
    const c = await m.coin("sol", DOPE);
    assert.deepEqual(c.pools!.map((p) => p.dex), ["pumpswap", "meteora", "meteora"]);
    assert.deepEqual(c.pools!.map((p) => p.address.slice(0, 6)), ["6iep3E", "FpRcdz", "MfUYgf"]);
    assert.ok(Math.abs(c.pools![0]!.liquidityUsd! - 239098.2694) < 1e-6);
    assert.ok(Math.abs(c.liquidityUsd! - 155444.0508699727) < 1e-3, "the token's total reserve, not one pool's");
    assert.equal(c.symbol, "DOPE"); assert.equal(c.name, "Doge Pepe"); assert.equal(c.decimals, 6);
    assert.ok(Math.abs(c.priceUsd! - 0.003321146636) < 1e-12);
    assert.equal(c.change24hPct, 5.03);
    assert.equal(c.holders, 9544);
    assert.deepEqual(c.security, { mintAuthority: false, freezeAuthority: false });
    assert.ok(Math.abs(c.marketCapUsd! - 3278613.46280941) < 1e-6);
    assert.ok(c.volume24hUsd! > 1_000_000);
    assert.match(c.logoUrl!, /^https:\/\//);
    // the last minute: the latest two one-minute candles' (high - low) / mid, in bps, asked behind the page (product decision, 4 Nov:
    // the page never waits for it) and in the engines' meta a moment later
    let mv: number | undefined;
    for (let i = 0; i < 50 && mv === undefined; i++) { await new Promise((res) => setTimeout(res, 2)); mv = (await m.meta("sol", DOPE))?.moveBps60s; }
    assert.equal(typeof mv, "number");
    assert.ok(mv! >= 0 && mv! < 10_000);
    // three calls: the token with its pools, its info, the minute candles
    assert.equal(r.calls.length, 3);
    // the Solana engine's regexes (direct.ts / curves.ts) still work on these ids
    assert.ok(c.pools!.filter((p) => /pumpswap|raydium/i.test(p.dex) && !/clmm|launchlab/i.test(p.dex)).length >= 1);
  });
  it("the engines' CoinMeta fields are all there, with nothing else a trade could mistake for them", async () => {
    const m = await mk(replay(routes())).meta("sol", DOPE);
    assert.ok(m);
    for (const k of Object.keys(m)) assert.ok(["symbol", "name", "decimals", "priceUsd", "liquidityUsd", "pools", "moveBps60s", "change24hPct"].includes(k), k);
    assert.equal(m!.symbol, "DOPE");
  });
  it("BNB Chain and Robinhood Chain: dex ids as GeckoTerminal names them, no Solana authorities", async () => {
    const m = mk(replay(routes()));
    const b = await m.coin("bsc", IRYS.toUpperCase().replace("0X", "0x"));
    assert.deepEqual(b.pools!.map((p) => p.dex), ["pancakeswap-v3-bsc", "pancakeswap-infinity-clmm", "uniswap-bsc"]);
    assert.equal(b.address, IRYS);
    assert.equal(b.security, undefined);
    const h = await m.coin("hood", SEASON);
    assert.deepEqual(h.pools!.map((p) => p.dex), ["pons-v2-dex", "uniswap-v4-robinhood", "uniswap-v4-robinhood"]);
    assert.equal(h.holders, 7504);
  });
  it("the market's own read, display only: holders' top-10 share, score, verified, the creator's share, a honeypot flag, the first pool's age (wallet v1's coin page)", async () => {
    const c = await mk(replay(routes())).coin("sol", DOPE);
    assert.deepEqual([c.top10Pct, c.score, c.verified, c.devPct, c.honeypot], [21.176, 86, true, 0, undefined], "honeypot 'unknown' is no flag");
    assert.equal(c.createdAt, Date.parse("2026-10-11T13:33:08Z"), "its first pool");
    const flagged = JSON.parse(JSON.stringify(fx("info-sol"))); flagged.data.attributes.is_honeypot = "yes";
    assert.equal((await mk(replay([[`${DOPE}/info`, flagged], ...routes()])).coin("sol", DOPE)).honeypot, true);
    assert.equal((await mk(replay(routes())).coin("hood", SEASON)).honeypot, undefined, "Robinhood's false is no flag either");
  });
  it("ALL: every day the coin has traded, from the daily candles (up to GeckoTerminal's 1000)", async () => {
    const r = replay(routes());
    await mk(r, { now: aged(r) }).candles("sol", DOPE, "ALL");
    assert.ok(r.calls.some((c) => /\/ohlcv\/day\?aggregate=1&limit=1000/.test(c.url)), r.calls.map((c) => c.url).join(" "));
  });
  it("a freeze authority that is set is exposed (display only)", async () => {
    const info = JSON.parse(JSON.stringify(fx("info-sol"))); info.data.attributes.freeze_authority = "yes";
    const c = await mk(replay([[`${DOPE}/info`, info], ...routes()])).coin("sol", DOPE);
    assert.equal(c.security?.freezeAuthority, true);
    assert.ok(c.pools!.length > 0, "and nothing else about the coin changes");
  });
  it("moveBps60s comes from live samples when someone is watching, else the candles; if the candles cannot be had it is simply undefined", async () => {
    const r = replay([["/ohlcv/minute", status(500)], ...routes()]);
    const c = await mk(r).coin("sol", DOPE);
    assert.equal(c.moveBps60s, undefined);
    assert.equal(c.symbol, "DOPE");
  });
  it("an address that is not a token address, or a coin GeckoTerminal does not know, is not_found", async () => {
    const m = mk(replay(routes()));
    await assert.rejects(m.coin("sol", "nope"), (e: unknown) => e instanceof MarketError && e.code === "not_found");
    await assert.rejects(m.coin("bsc", "0x1234"), (e: unknown) => e instanceof MarketError && e.code === "not_found");
    await assert.rejects(m.coin("bsc", "0x" + "ab".repeat(20)), (e: unknown) => e instanceof MarketError && e.code === "not_found");
  });
});

describe("the Solana dex ids GeckoTerminal uses are the ones the engine's regexes expect", () => {
  it("captured new pools: every curve venue id matches the curve regex and none of the direct ones", () => {
    const CURVE = /meteora-dbc|bags|dbc|launchlab|letsbonk|bonk|damm-v2|damm/i; // sol/curves.ts CURVE_DEX
    const seen = new Set<string>(fx("new-pools-sol").data.map((p: any) => p.relationships.dex.data.id as string));
    for (const id of ["meteora-dbc", "meteora-damm-v2", "pump-fun", "raydium-launchlab", "pumpswap"]) assert.ok(seen.has(id), id);
    for (const id of ["meteora-dbc", "meteora-damm-v2", "raydium-launchlab"]) assert.ok(CURVE.test(id), id);
    assert.ok(!CURVE.test("pumpswap") && !CURVE.test("raydium") && !CURVE.test("raydium-clmm"));
    const direct = (dex: string) => /pumpswap|raydium/i.test(dex) && !/clmm|launchlab/i.test(dex);
    assert.ok(direct("pumpswap") && direct("raydium") && !direct("raydium-clmm") && !direct("raydium-launchlab") && !direct("meteora"));
  });
});

describe("meta(): fast, from the cache, refreshed in the background", () => {
  it("cold: waits only the budget (120 ms) and answers undefined if the network is slower; the fetch finishes and the next call is instant", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const r = replay(routes());
    const slow: typeof fetch = async (u, i) => { await gate; return r.fetch(u, i); };
    const m = createMarket({ fetch: slow, now: r.now, metaWaitMs: 20 });
    // order, not wall time: meta() answers while the network is still held (the 5 s guard only turns a hang into a failure)
    const first = await Promise.race([m.meta("sol", DOPE), new Promise((res) => setTimeout(() => res("waited for the network"), 5_000))]);
    assert.equal(first, undefined, "answered before the fetch finished");
    assert.equal(r.calls.length, 0, "the fetch is still held");
    release();
    let meta;
    for (let i = 0; i < 200 && !(meta = await m.meta("sol", DOPE)); i++) await new Promise((res) => setImmediate(res));
    assert.equal(meta?.symbol, "DOPE", "the background fetch landed in the cache");
    assert.equal(r.calls.length, 1, "and the next call cost no second fetch");
  });
  it("warm: an answer inside 30 s costs no call; an older one is returned AT ONCE and refreshed once in the background", async () => {
    const r = replay(routes());
    const m = mk(r);
    await m.meta("sol", DOPE);
    await m.meta("sol", DOPE);
    assert.equal(r.calls.length, 1);
    r.clock.t += 45_000;
    const a = await m.meta("sol", DOPE);
    assert.equal(a?.symbol, "DOPE");
    await Promise.all([m.meta("sol", DOPE), m.meta("sol", DOPE), m.meta("sol", DOPE)]);
    await new Promise((res) => setTimeout(res, 10));
    assert.equal(r.calls.length, 2, "one refresh however many engines asked");
  });
  it("when the network is down, an old answer is still served (up to 15 minutes); a coin never seen is undefined, not an error", async () => {
    let down = false;
    const r = replay([[`tokens/${DOPE}`, () => (down ? status(500) : fx("token-sol"))]]);
    const m = mk(r);
    await m.meta("sol", DOPE);
    down = true; r.clock.t += 120_000;
    assert.equal((await m.meta("sol", DOPE))?.symbol, "DOPE");
    assert.equal(await m.meta("sol", "11111111111111111111111111111112"), undefined);
    assert.equal(await m.meta("sol", "not an address"), undefined);
  });
  it("a coin seen in trending is known at once from its row (price, name, its ranked pool and dex) but without a total liquidity, until the full answer lands", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const r = replay(routes());
    const slowTokens: typeof fetch = async (u, i) => { if (String(u).includes("/tokens/")) await gate; return r.fetch(u, i); };
    const m = createMarket({ fetch: slowTokens, now: r.now, metaWaitMs: 10 });
    await m.trending("sol");
    const row = await m.meta("sol", DOPE);
    assert.equal(row?.symbol, "DOPE");
    assert.equal(row?.pools?.length, 1);
    assert.equal(row?.pools?.[0]?.dex, "pumpswap");
    assert.equal(row?.liquidityUsd, undefined, "one pool's reserve is never passed off as the coin's liquidity");
    release();
    await new Promise((res) => setTimeout(res, 30));
    const full = await m.meta("sol", DOPE);
    assert.equal(full?.pools?.length, 3);
    assert.ok(full?.liquidityUsd! > 100_000);
    r.clock.t += 5_000;
    await m.trending("sol");
    assert.equal((await m.meta("sol", DOPE))?.pools?.length, 3, "a list never replaces the full answer");
  });
});

describe("candles", () => {
  it("the coin page after a busy Discover: its details and its chart wait for room in the 10 s cap instead of saying busy", async () => {
    const r = replay(routes());
    const m = mk(r, { storage: null, screenWaitMs: 10_000, sleep: async (ms) => { r.clock.t += ms; } });
    await m.trending();
    for (const c of ["sol", "bsc", "hood"] as ChainId[]) await m.trending(c).catch(() => undefined);
    const [d, c] = await Promise.all([m.coin("sol", DOPE), m.candles("sol", DOPE, "1D")]);
    assert.equal(d.address, DOPE);
    assert.ok(c.length > 0);
    assert.ok(r.maxInWindow(GT_BURST.perMs) <= GT_BURST.calls);
  });
  it("1H: sixty one-minute candles of the main pool, ascending, in ms, USD", async () => {
    const r = replay(routes());
    const c = await mk(r).candles("sol", DOPE, "1H");
    assert.equal(c.length, 60);
    assert.ok(c.every((x, i) => i === 0 || x.t > c[i - 1]!.t));
    assert.ok(c[0]!.t > 1.7e12 && c[0]!.t < 2e12, "milliseconds");
    assert.ok(c.every((x) => x.h >= x.l && x.c > 0 && x.v >= 0));
    const pool = r.calls.find((x) => x.url.includes("/ohlcv/"))!.url;
    assert.match(pool, /pools\/6iep3EgqksbZwgzMBCyAJtiVtVYkCgL9BnPBEwLR8AGQ\/ohlcv\/minute\?aggregate=1&limit=60&currency=usd&include_empty_intervals=true&token=33jENUQ/);
  });
  it("each range is one call of the right size; 1W and 1M share ONE hourly call; 1M is grouped into 2-hour candles", async () => {
    const r = replay(routes());
    const m = mk(r, { now: aged(r) });
    await m.candles("sol", DOPE, "1D");
    assert.match(r.calls.at(-1)!.url, /ohlcv\/minute\?aggregate=5&limit=288/);
    // audit 2 Nov: a quiet minute is a flat candle, so 288 five-minute candles are 24 hours (without: 44 hours on PENGU)
    assert.match(r.calls.at(-1)!.url, /&include_empty_intervals=true&/);
    const w = await m.candles("sol", DOPE, "1W");
    const month = await m.candles("sol", DOPE, "1M");
    assert.equal(r.count("/ohlcv/hour"), 1);
    assert.match(r.calls.at(-1)!.url, /ohlcv\/hour\?aggregate=1&limit=720&currency=usd&include_empty_intervals=true&/);
    assert.equal(w.length, 24, "the fixture holds 24 hours");
    assert.ok(month.length <= 13 && month.length < w.length && month.length >= 12, `${month.length} two-hour candles from 24 hourly`);
    assert.equal(month.reduce((a, x) => a + x.v, 0).toFixed(3), w.reduce((a, x) => a + x.v, 0).toFixed(3), "volume is conserved by grouping");
    await m.candles("sol", DOPE, "1Y");
    assert.match(r.calls.at(-1)!.url, /ohlcv\/day\?aggregate=1&limit=365/);
    assert.doesNotMatch(r.calls.at(-1)!.url, /include_empty_intervals/, "days: every day it traded, never padded back");
  });
  it("bug report, 4 Nov: a range longer than the coin's life draws its life in fine candles (the fixture's coin is 14 days old)", async () => {
    const r = replay(routes());
    const m = mk(r);
    for (const range of ["1M", "1Y", "ALL"] as const) {
      await m.candles("sol", DOPE, range);
      assert.match(r.calls.at(-1)!.url, /ohlcv\/hour\?aggregate=1&limit=720&currency=usd&include_empty_intervals=true&token=/, `${range}: the 1M plan, never a handful of daily candles`);
    }
    assert.equal(r.count("/ohlcv/day"), 0);
    await m.candles("sol", DOPE, "1W");
    assert.match(r.calls.at(-1)!.url, /ohlcv\/hour\?aggregate=1&limit=720/, "a week is shorter than its life: the week's own hours");
  });
  it("the pool is the deepest one, found with one token call if the coin was never seen", async () => {
    const r = replay(routes());
    await mk(r).candles("sol", DOPE, "1W");
    assert.equal(r.count(`tokens/${DOPE}`), 1);
    assert.equal(r.count("/ohlcv/"), 1);
  });
  it("garbage in the answer is an error, not a chart of zeros", async () => {
    const r = replay([["/ohlcv/", { data: { attributes: { ohlcv_list: "x" } } }], ...routes()]);
    await assert.rejects(mk(r).candles("sol", DOPE, "1W"), (e: unknown) => e instanceof MarketError && e.code === "bad_response");
  });
});

describe("nativeUsd", () => {
  it("one CoinGecko call prices SOL, BNB and ETH; cached 30 s", async () => {
    const r = replay(routes());
    const m = mk(r);
    assert.deepEqual(await Promise.all((["sol", "bsc", "hood"] as ChainId[]).map((c) => m.nativeUsd(c))), [101.67, 744.17, 2347.2]);
    await m.nativeUsd("sol");
    assert.equal(r.calls.length, 1);
    assert.match(r.calls[0]!.url, /^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?ids=solana,binancecoin,ethereum,near&vs_currencies=usd$/);
    r.clock.t += 31_000;
    await m.nativeUsd("sol");
    assert.equal(r.calls.length, 2);
  });
  it("an old price is returned at once while a new one is fetched; when CoinGecko is down, GeckoTerminal's price of the wrapped coin is the fallback", async () => {
    let cgDown = false;
    const r = replay([["api.coingecko.com", () => (cgDown ? status(429) : fx("cg-simple-price"))], ["simple/networks/solana/token_price", fx("price-sol")]]);
    const m = mk(r);
    await m.nativeUsd("sol");
    cgDown = true; r.clock.t += 40_000;
    assert.equal(await m.nativeUsd("sol"), 101.67);
    // a chain never priced: CoinGecko is not asked again for 15 s, GeckoTerminal answers instead
    const m2 = mk(replay([["api.coingecko.com", status(500)], ["simple/networks/solana/token_price", fx("price-sol")]]));
    const v = await m2.nativeUsd("sol");
    assert.ok(Math.abs(v - 101.5179) < 0.001);
    await assert.rejects(mk(replay([])).nativeUsd("bsc"));
  });
});

describe("livePrice", () => {
  // deterministic: node:test's mock timers drive the poller (its first tick comes 50 ms after the first watcher)
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((res) => setImmediate(res)); };
  const step = async (t: { mock: { timers: { tick(ms: number): void } } }, ms: number) => { t.mock.timers.tick(ms); await flush(); };
  it("two screens watching one coin share one call per tick; the price arrives; the last unsubscribe stops the polling", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const r = replay(routes());
    const m = mk(r, { livePollMs: 20 });
    const a: number[] = [], b: number[] = [];
    const ua = m.livePrice("sol", DOPE, (p) => a.push(p)), ub = m.livePrice("sol", DOPE, (p) => b.push(p));
    for (let i = 0; i < 6; i++) await step(t, 20);
    assert.ok(a.length >= 1 && b.length >= 1);
    assert.ok(Math.abs(a[0]! - 0.00333387712) < 1e-9);
    assert.equal(a.length, b.length, "both screens hear every tick");
    assert.ok(r.count("token_price") <= a.length + 1, "one call per tick, shared");
    ua(); ub();
    const after = r.calls.length;
    for (let i = 0; i < 6; i++) await step(t, 20);
    assert.equal(r.calls.length, after, "nothing polls once nobody watches");
  });
  it("one call covers every coin watched on a chain; the coin's meta() price follows it", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const r = replay(routes());
    const m = mk(r, { livePollMs: 200 });
    const warm = m.meta("sol", DOPE);
    await step(t, 200);
    await warm;
    const got: Record<string, number> = {};
    const u1 = m.livePrice("sol", DOPE, (p) => { got.dope = p; }), u2 = m.livePrice("sol", WSOL, (p) => { got.sol = p; });
    await step(t, 60);
    assert.equal(r.count("token_price"), 1);
    assert.ok(got.dope! > 0 && got.sol! > 0);
    assert.ok(Math.abs((await m.meta("sol", DOPE))!.priceUsd! - got.dope!) < 1e-15);
    u1(); u2();
  });
  it("audit 2 Nov: a poll the budget skipped re-serves the last answer with that answer's own time, never as just heard", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const r = replay(routes([["api.coingecko.com", () => status(500)]]));
    // one call a minute, so the background poll can never go out (its share of one is none)
    const m = mk(r, { livePollMs: 20_000, budget: { calls: 1, perMs: 60_000 }, storage: null });
    const t0 = r.clock.t;
    const sol = await m.nativeUsd("sol");                               // CoinGecko down: GeckoTerminal's WSOL, read at t0
    r.clock.t += 5 * 60_000;                                            // five minutes on, and the poll can't be made
    const got: [number, number][] = [];
    const u = m.livePrice("sol", WSOL, (p, at) => got.push([p, at]));
    await step(t, 60);
    u();
    assert.equal(r.count("token_price"), 1, "nothing new was asked");
    assert.deepEqual(got, [[sol, t0]], "the price it had, dated when it was read: the page says \"Updated 5 min ago\"");
  });
  it("the chain's own coin ('native') is priced from nativeUsd", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const r = replay(routes());
    const m = mk(r, { livePollMs: 200 });
    let v = 0;
    const u = m.livePrice("bsc", "native", (p) => { v = p; });
    await step(t, 60);
    u();
    assert.equal(v, 744.17);
  });
  it("a flood of watchers cannot break the budget: background polling stops at 60% of the window", async (t) => {
    // deterministic: node:test's mock timers drive the poller and the market's clock moves with them, one virtual second at
    // a time, so the counts never depend on how busy the machine is
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const rr = replay([["token_price", fx("price-sol")]]);
    const m = createMarket({ fetch: rr.fetch, now: rr.now, livePollMs: 2_000, storage: null });
    const subs = (["sol", "bsc", "hood"] as ChainId[]).map((c) => m.livePrice(c, c === "sol" ? DOPE : c === "bsc" ? IRYS : SEASON, () => {}));
    const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); };
    for (let s = 0; s < 200; s++) { rr.clock.t += 1_000; t.mock.timers.tick(1_000); await flush(); }
    subs.forEach((u) => u());
    assert.ok(rr.calls.length > 20, `${rr.calls.length} calls`);
    assert.ok(rr.maxInWindow(60_000) <= Math.floor(GT_BUDGET.calls * 0.6), `${rr.maxInWindow(60_000)} in a minute`);
    assert.ok(m.stats().lowSkipped > 0);
  });
});

describe("a busy Discover screen never goes over GeckoTerminal's limit", () => {
  it("five virtual minutes: trending refreshed every 10 s, a new search every 7 s, a coin page every 20 s, meta for 40 coins per quote burst; never above 25 calls in any 60 s, and every screen still gets rows", async () => {
    const r = replay(routes());
    const m = mk(r);
    const queries = ["pepe", "pepe ", "PEPE", "pepe2"].map((q, i) => (i === 0 ? q : q));
    let rowsServed = 0, rate = 0, failures = 0;
    const dopes: string[] = [DOPE, WSOL];
    for (let s = 0; s < 300; s++) {
      r.clock.t += 1_000;
      const jobs: Promise<unknown>[] = [];
      if (s % 10 === 0) jobs.push(m.trending().then((x) => { rowsServed += x.length ? 1 : 0; }));
      if (s % 10 === 5) for (const c of ["sol", "bsc", "hood"] as ChainId[]) jobs.push(m.trending(c).then((x) => { rowsServed += x.length ? 1 : 0; }));
      if (s % 7 === 0) jobs.push(m.search(queries[(s / 7 | 0) % 4]! + (s % 14 === 0 ? "" : "")).then((x) => { rowsServed += x.length ? 1 : 0; }));
      if (s % 20 === 0) jobs.push(m.coin("sol", DOPE).then(() => { rowsServed++; }), m.candles("sol", DOPE, (["1H", "1D", "1W", "1M", "1Y"] as const)[(s / 20 | 0) % 5]!));
      if (s % 3 === 0) for (const a of dopes) jobs.push(m.meta("sol", a));
      for (const j of jobs) await j.catch((e) => { if (e instanceof MarketError && e.code === "rate") rate++; else { failures++; if (failures < 4) console.log("FAIL", String(e)); } });
    }
    assert.ok(r.maxInWindow(60_000) <= GT_BUDGET.calls, `${r.maxInWindow(60_000)} calls in a minute`);
    assert.ok(r.maxInWindow(GT_BURST.perMs) <= GT_BURST.calls, `${r.maxInWindow(GT_BURST.perMs)} calls in 10 s`);
    assert.equal(failures, 0);
    assert.ok(rowsServed > 60, `${rowsServed} lists served`);
    assert.ok(r.calls.length > 40, "the test really did ask for a lot");
    // the 10 s cap refuses a few of this synthetic load's peaks (seconds where trending, three chains, a search, a coin page
    // and its candles all ask at once); every screen still gets its rows, fresh or from the last answer
    assert.ok(rate <= 10, `${rate} requests got a 'budget used up' error`);
  });
  it("a burst of 60 different searches in one second spends at most the budget; the rest are refused cleanly, not queued up against the limit", async () => {
    const r = replay([["search/pools", fx("search-all")]]);
    const m = mk(r);
    const res = await Promise.allSettled(Array.from({ length: 60 }, (_, i) => m.search(`pepe${i}`)));
    assert.equal(r.calls.length, GT_BURST.calls, "the 10 s cap: the rest are refused at once");
    assert.ok(res.some((x) => x.status === "rejected"));
    assert.ok(res.every((x) => x.status === "fulfilled" || (x.reason instanceof MarketError)));
  });
  it("after a 429 from the real service nothing is sent until it is over, and the last list is still shown", async () => {
    let limited = false;
    const r = replay([["networks/solana/trending_pools", () => (limited ? status(429, { "retry-after": "30" }) : fx("trending-solana"))]]);
    const m = mk(r);
    const first = await m.trending("sol");
    r.clock.t += 61_000; limited = true;
    assert.equal((await m.trending("sol")).length, first.length);
    const n = r.calls.length;
    r.clock.t += 5_000;
    assert.equal((await m.trending("sol")).length, first.length);
    assert.equal(r.calls.length, n, "blocked for the retry-after");
    r.clock.t += 30_000; limited = false;
    await m.trending("sol");
    assert.equal(r.calls.length, n + 1);
  });
});

// The public build's CSP: img-src is 'self' data: blob: and the relay. In mainnet mode (a relay set) every coin image a
// list, a search or a coin page hands the screens must come through the relay's /v0/market/logo (or be a bundled data:
// logo), never straight from CoinGecko's or GeckoTerminal's image hosts, which the CSP would block.
describe("logos under the public CSP", () => {
  it("with a relay, every logo of every list, search and coin page is the relay's or a bundled one; without, the market's own hosts show up (the control)", async () => {
    const collect = async (o: Parameters<typeof createMarket>[0]) => {
      const m = mk(replay(routes()), o);
      const rows = [...(await m.trending()), ...(await m.trending("sol")), ...(await m.trending("bsc")), ...(await m.trending("hood")), ...(await m.search("dope"))];
      const pages = await Promise.all([m.coin("sol", DOPE), m.coin("hood", SEASON), m.coin("bsc", IRYS)]);
      return [...rows, ...pages].map((x) => x.logoUrl).filter((u): u is string => !!u);
    };
    const relayed = await collect({ relay: "https://relay.example" });
    assert.ok(relayed.length >= 20, `logos seen: ${relayed.length}`);
    for (const u of relayed) assert.match(u, /^(https:\/\/relay\.example\/v0\/market\/logo\?c=(sol|bsc|hood|near)&a=[^&]+$|data:image\/svg\+xml)/, u);
    const plain = await collect({});
    assert.ok(plain.some((u) => /coingecko|geckoterminal/.test(u)), "the recorded data does name the market's own image hosts");
  });
});
