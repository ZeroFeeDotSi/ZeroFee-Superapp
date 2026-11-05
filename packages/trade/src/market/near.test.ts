// TN1 (2 Nov 2026): NEAR coins in Trade's market, on GeckoTerminal's own `near` answers captured read-only that evening
// (fixtures/trending-near.json, token-near.json, pool-near-rhea.json): trending, a coin page, a pasted address or link of
// every shape (nep141 accounts, a 64-hex account, Rhea and NEAR Intents pools, nearblocks / Rhea / GeckoTerminal links),
// a coin GeckoTerminal doesn't list named from its own contract, and the same budget and stale rules as the other chains.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMarket, NEAR_RHEA_PAGES } from "./index.ts";
import { CHAINS, GT_NETWORK, createGt } from "./gt.ts";
import { isMoneyPool, normAddr, poolViews, validTokenAddress } from "./map.ts";
import { createNearRpc, nearFacts, nearPasted, type NearRpc } from "./near.ts";
import { parseOhlcv } from "./candles.ts";
import { createRelayFetch } from "./relay.ts";
import { fx, replay, status } from "./testing.ts";

const QTC = "qtc.omft.near";
const mk = (r: ReturnType<typeof replay>, o: Parameters<typeof createMarket>[0] = {}) => createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0, storage: null, ...o });
/** A NEAR node that knows one coin: its ft_metadata and ft_total_supply as the contract answers them. */
const node = (coins: Record<string, { symbol: string; name: string; decimals: number; supply: string }>): NearRpc & { calls: string[] } => {
  const calls: string[] = [];
  const rpc = (async (_m: string, p: any) => {
    calls.push(`${p.account_id}.${p.method_name}`);
    const c = coins[p.account_id];
    if (!c) throw new Error(`UNKNOWN_ACCOUNT account ${p.account_id} does not exist`);
    const v = p.method_name === "ft_metadata" ? { spec: "ft-1.0.0", symbol: c.symbol, name: c.name, decimals: c.decimals, icon: null } : c.supply;
    return { result: [...new TextEncoder().encode(JSON.stringify(v))] };
  }) as NearRpc & { calls: string[] };
  rpc.calls = calls;
  return rpc;
};

describe("NEAR is one of Trade's market chains", () => {
  it("GeckoTerminal's `near` network, in the chains every list and search reads", () => {
    assert.equal(GT_NETWORK.near, "near");
    assert.ok(CHAINS.includes("near"));
  });
  it("a NEAR coin's address is its contract account, lower-case; an EVM or Solana shape is not one", () => {
    for (const a of [QTC, "blackdragon.tkn.near", "token.v2.ref-finance.near", "wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", "a_b.near"])
      assert.ok(validTokenAddress("near", a), a);
    for (const a of ["", "-a.near", "a..near", "a.near.", "UPPER.near", "nep141:qtc.omft.near", "x".repeat(65), "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump", "nep245:v2_1.omni.hot.tg:56_2cmmyvtgzkeynztsvs5sarzfir6g"])
      assert.ok(!validTokenAddress("near", a), a);
    assert.equal(normAddr("near", "QTC.OMFT.NEAR"), QTC);
  });
});

describe("trending on NEAR: GeckoTerminal's own list, money pools out", () => {
  it("trending once (Rhea's pages beside it); each row a NEAR coin (QTC, ZEC, RHEA…), never USDC, USDT or wNEAR as the coin; Rhea and Intents pools both read", async () => {
    const r = replay([["networks/near/trending_pools", fx("trending-near")]]);
    const rows = await mk(r).trending("near");
    assert.equal(r.count("networks/near/trending_pools"), 1);
    // and Rhea's pages (here not found: the trending rows stand alone); on the keyless public API the last page is
    // background work, asked only when the short window has room (gt.ts LOW_SHARE)
    assert.ok(r.calls.length >= 2 && r.calls.length <= 1 + NEAR_RHEA_PAGES, `${r.calls.length}`);
    assert.ok(rows.length >= 5, `${rows.length} rows`);
    const syms = rows.map((x) => x.symbol);
    for (const s of ["QTC", "ZEC", "RHEA"]) assert.ok(syms.includes(s), `${s} in ${syms}`);
    for (const s of ["USDC", "USDT", "wNEAR"]) assert.ok(!syms.includes(s), `${s} is money, not a coin: ${syms}`);
    assert.ok(rows.every((x) => x.chain === "near" && validTokenAddress("near", x.address) && x.priceUsd! > 0));
    // a coin once, however many pools it trends in (QTC trends in three)
    assert.equal(new Set(rows.map((x) => x.address)).size, rows.length);
    const views = poolViews("near", fx("trending-near"));
    assert.ok(views.some((v) => v.dex === "rhea-finance") && views.some((v) => v.dex === "near-intents"));
    assert.ok(views.filter((v) => v.coin.symbol === "USDC" || v.coin.symbol === "USDT").every(isMoneyPool));
  });
  it("a 429 serves the last list, marked with its time, never a blank", async () => {
    let n = 0;
    const r = replay([["networks/near/trending_pools", () => (n++ === 0 ? fx("trending-near") : status(429, { "retry-after": "30" }))]]);
    const m = mk(r);
    const first = await m.trending("near");
    r.clock.t += 10 * 60_000;
    const again = await m.trending("near");
    assert.deepEqual(again.map((x) => x.address), first.map((x) => x.address));
    assert.ok((again as { asOf?: number }).asOf, "marked as of its time");
  });
});

// S13 (5 Nov): GeckoTerminal's own near answers of
// that afternoon (fixtures trending-near-s13: 17 NEAR Intents + 3 Rhea pools, mostly money pairs; rhea-near-1..3: Rhea's
// own pools; new-pools-near-1..2), captured read-only.
describe("S13: NEAR's lists show NEAR's coins, Rhea's first", () => {
  const RELAY = "https://relay.example";
  const routes = (): Parameters<typeof replay>[0] => [
    ["networks/near/trending_pools", fx("trending-near-s13")],
    ...[1, 2, 3].map((n) => [`networks/near/dexes/rhea-finance/pools?include=base_token%2Cquote_token%2Cdex&page=${n}`, fx(`rhea-near-${n}`)] as [string, unknown]),
    ["networks/near/new_pools?include=base_token%2Cquote_token%2Cdex&page=1", fx("new-pools-near-1")],
    ["networks/near/new_pools?include=base_token%2Cquote_token%2Cdex&page=2", fx("new-pools-near-2")],
  ];
  it("control: the trending answer alone leaves a short list of bridged coins (what a test showed)", () => {
    const alone = poolViews("near", fx("trending-near-s13")).filter((v) => !isMoneyPool(v));
    assert.ok(new Set(alone.map((v) => v.coin.address)).size <= 12, `${alone.length}`);
    assert.ok(!alone.some((v) => v.coin.symbol === "BLACKDRAGON" || v.coin.symbol === "SHITZU"));
  });
  it("trending + Rhea's 3 pages (through the relay, the app's door): 15+ coins, one row each, Rhea coins first, no pure money pair (USDC/USDt, DAI/USDC.e, FRAX)", async () => {
    const r = replay(routes());
    const rows = await mk(r, { relay: RELAY }).trending("near");
    assert.ok(r.calls.every((c) => c.url.startsWith(`${RELAY}/v0/market/gt/networks/near/`)), r.calls.map((c) => c.url).join("\n"));
    assert.equal(r.calls.length, 1 + NEAR_RHEA_PAGES);
    for (let n = 1; n <= NEAR_RHEA_PAGES; n++) assert.equal(r.count(`dexes/rhea-finance/pools?include=base_token%2Cquote_token%2Cdex&page=${n}`), 1, `page ${n}`);
    assert.ok(rows.length >= 15, `${rows.length} rows: ${rows.map((x) => x.symbol)}`);
    assert.equal(new Set(rows.map((x) => x.address)).size, rows.length, "a coin once");
    const syms = rows.map((x) => x.symbol);
    for (const s of ["RHEA", "BLACKDRAGON", "SHITZU", "AURORA", "SWEAT", "NEARLY", "QTC", "ZEC"]) assert.ok(syms.includes(s), `${s} in ${syms}`);
    for (const s of ["USDC", "USDt", "USDT", "USDT.e", "USDC.e", "wNEAR", "DAI", "FRAX"]) assert.ok(!syms.includes(s), `${s} is money: ${syms}`);
    // Rhea first: every coin met in a Rhea pool comes before the coins only NEAR Intents trend
    const rheaCoins = new Set([...poolViews("near", fx("trending-near-s13")), ...[1, 2, 3].flatMap((n) => poolViews("near", fx(`rhea-near-${n}`)))].filter((v) => v.dex === "rhea-finance").map((v) => v.coin.address));
    const firstOther = rows.findIndex((x) => !rheaCoins.has(x.address));
    assert.ok(firstOther >= 10, `first Intents-only coin at ${firstOther}: ${syms}`);
    assert.ok(rows.slice(firstOther).every((x) => !rheaCoins.has(x.address)), syms.join());
    // a coin paired with a dollar or wNEAR shows as the coin (QTC / USDC, BLACKDRAGON / wNEAR)
    assert.ok(rows.every((x) => x.chain === "near" && x.priceUsd! > 0));
  });
  it("a Rhea page failing never blanks the list; trending failing still shows Rhea's coins", async () => {
    const r1 = replay([["networks/near/trending_pools", fx("trending-near-s13")], ["page=2", () => status(500)], ...routes()]);
    assert.ok((await mk(r1, { relay: RELAY }).trending("near")).length >= 12);
    const r2 = replay([["networks/near/trending_pools", () => status(500)], ...routes().slice(1)]);
    const rows = await mk(r2, { relay: RELAY }).trending("near");
    assert.ok(rows.length >= 12 && rows.map((x) => x.symbol).includes("RHEA"), rows.map((x) => x.symbol).join());
    const r3 = replay([["geckoterminal", () => status(500)]]);
    await assert.rejects(mk(r3).trending("near"), "every page failing is the list's failure, never an empty list");
  });
  it("NEAR's New list reads two pages, newest first; a page alone is a short list (the control)", async () => {
    const r = replay(routes());
    const rows = await mk(r).fresh!("near");
    assert.equal(r.count("networks/near/new_pools"), 2);
    const one = await mk(replay(routes().filter(([k]) => !k.endsWith("page=2")))).fresh!("near");
    assert.ok(rows.length > one.length, `${rows.length} vs ${one.length}`);
    assert.ok(rows.length >= 8, rows.map((x) => x.symbol).join());
    assert.deepEqual(rows.map((x) => x.createdAt), [...rows.map((x) => x.createdAt)].sort((a, b) => (b ?? 0) - (a ?? 0)));
    for (const x of rows) assert.ok(!["USDC", "USDt", "wNEAR"].includes(x.symbol), x.symbol);
  });
  it("Solana's New list stays one call", async () => {
    const r = replay([["networks/solana/new_pools", fx("new-pools-sol")]]);
    await mk(r).fresh!("sol");
    assert.equal(r.calls.length, 1);
  });
});

describe("a NEAR coin's page", () => {
  it("price, liquidity, market cap and its pools (Intents and Rhea) from GeckoTerminal's token answer", async () => {
    const r = replay([[`networks/near/tokens/${QTC}/info`, () => status(404)], [`networks/near/tokens/${QTC}?`, fx("token-near")], ["/ohlcv/", { data: { attributes: { ohlcv_list: [] } } }]]);
    const d = await mk(r).coin("near", QTC);
    assert.equal(d.chain, "near");
    assert.equal(d.symbol, "QTC");
    assert.equal(d.decimals, 12);
    assert.ok(d.priceUsd! > 0 && d.liquidityUsd! > 0);
    const dexes = new Set(d.pools!.map((p) => p.dex));
    assert.ok(dexes.has("near-intents") && dexes.has("rhea-finance"), [...dexes].join());
  });
  it("a coin GeckoTerminal doesn't list is named from its own contract (ft_metadata), and its page opens", async () => {
    const coin = "newcoin.meme-cooking.near";
    const rpc = node({ [coin]: { symbol: "NEWC", name: "New Coin", decimals: 18, supply: "1000000000000000000000000" } });
    const r = replay([[`networks/near/tokens/${coin}`, () => status(404)]]);
    const m = mk(r, { nearRpc: rpc });
    const rows = await m.search(coin);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.chain, rows[0]!.address, rows[0]!.symbol, rows[0]!.name], ["near", coin, "NEWC", "New Coin"]);
    const d = await m.coin("near", coin);
    assert.equal(d.symbol, "NEWC");
    assert.equal(d.fromChain, true);
  });
});

describe("a pasted NEAR address, pool or link resolves", () => {
  it("every shape is read as the coin (or the pool it names); a bare word is a name to search for", () => {
    const cases: [string, ReturnType<typeof nearPasted>][] = [
      [QTC, { coin: QTC }], ["  QTC.OMFT.NEAR ", { coin: QTC }], [`nep141:${QTC}`, { coin: QTC }],
      ["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", { coin: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" }],
      ["refv1-6065", { pool: "refv1-6065" }], [`refv2-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1:${QTC}:2000`, { pool: `refv2-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1:${QTC}:2000` }],
      ["nep141:wrap.near___nep141:zec.omft.near", { coin: "zec.omft.near" }],
      [`nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near___nep141:${QTC}`, { coin: QTC }],
      [`https://nearblocks.io/token/${QTC}`, { coin: QTC }],
      ["https://www.geckoterminal.com/near/pools/refv1-6065", { pool: "refv1-6065" }],
      [`https://app.rhea.finance/#wrap.near|${QTC}`, { coin: QTC }],
      ["pepe", undefined], ["dogwifhat", undefined], ["https://example.com/token/qtc.omft.near", undefined], ["33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump", undefined],
    ];
    for (const [q, want] of cases) assert.deepEqual(nearPasted(q), want, q);
  });
  it("search of a pasted NEAR coin asks GeckoTerminal for that coin, never a name search", async () => {
    const r = replay([[`networks/near/tokens/${QTC}?`, fx("token-near")]]);
    const rows = await mk(r).search(`https://nearblocks.io/token/${QTC}`);
    assert.equal(rows[0]?.address, QTC);
    assert.ok(r.calls.every((c) => !c.url.includes("search/pools")), r.calls.map((c) => c.url).join("\n"));
  });
  it("a pasted Rhea pool is its coin: the side that isn't wNEAR or a dollar", async () => {
    const r = replay([["networks/near/pools/refv1-6065", fx("pool-near-rhea")], ["networks/near/tokens/zec.omft.near?", fx("token-near")]]);
    await mk(r).search("refv1-6065");
    assert.ok(r.calls.some((c) => c.url.includes("networks/near/tokens/zec.omft.near")), r.calls.map((c) => c.url).join("\n"));
  });
});

describe("the chain's own word on a nep141 coin", () => {
  it("ft_metadata and ft_total_supply; an account that isn't a coin is no coin, a node that can't be reached throws", async () => {
    const rpc = node({ "blackdragon.tkn.near": { symbol: "BLACKDRAGON", name: "Black Dragon", decimals: 24, supply: "1" } });
    const f = await nearFacts(rpc, "blackdragon.tkn.near");
    assert.deepEqual([f?.symbol, f?.name, f?.decimals, f?.supply], ["BLACKDRAGON", "Black Dragon", 24, 1n]);
    assert.equal(await nearFacts(rpc, "nobody.near"), undefined);
    await assert.rejects(nearFacts(async () => { throw new Error("fetch failed"); }, "x.near"));
  });
  it("the node reader goes to the next host when one is down, and a node's own error is the coin's answer", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      if (url.includes("fastnear")) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { result: [123] } }));
    }) as unknown as typeof fetch;
    const r = await createNearRpc(f)("query", {});
    assert.deepEqual(r, { result: [123] });
    assert.equal(seen.length, 2);
    const bad = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { cause: { name: "UNKNOWN_ACCOUNT" }, data: "no" } }))) as unknown as typeof fetch;
    await assert.rejects(createNearRpc(bad)("query", {}), /UNKNOWN_ACCOUNT/);
  });
});

describe("the same rules as the other chains", () => {
  it("NEAR's calls spend the one GeckoTerminal budget: 25 a minute, 6 in 10 s, whatever the chain", async () => {
    const r = replay([["api.geckoterminal.com", fx("trending-near")]]);
    const gt = createGt({ fetch: r.fetch, now: r.now, storage: null });
    const asks = Array.from({ length: 9 }, (_, i) => gt.get(`networks/near/trending_pools?page=${i}`, 60_000, "low").then(() => "ok", () => "no"));
    const got = await Promise.all(asks);
    assert.ok(got.filter((x) => x === "ok").length <= 6, got.join());
  });
  it("candles that come twice for one minute are one candle, and times only rise", () => {
    const c = parseOhlcv({ data: { attributes: { ohlcv_list: [[120, 5, 6, 4, 5.5, 1], [120, 4, 5, 3, 5, 2], [60, 3, 4, 2, 4, 1]] } } });
    assert.deepEqual(c.map((x) => x.t), [60_000, 120_000]);
    assert.deepEqual(c[1], { t: 120_000, o: 4, h: 6, l: 3, c: 5.5, v: 3 });
  });
  it("through the relay: a path it doesn't serve yet (quotes.route.unknown) goes to GeckoTerminal itself; a coin it doesn't know stays a 404", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      if (url.startsWith("https://relay.test/")) return new Response(JSON.stringify({ code: url.includes("near") ? "quotes.route.unknown" : "quotes.market.none" }), { status: 404 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const rf = createRelayFetch("https://relay.test", f);
    assert.equal((await rf("https://api.geckoterminal.com/api/v2/networks/near/trending_pools")).status, 200);
    assert.equal((await rf("https://api.geckoterminal.com/api/v2/networks/solana/tokens/x")).status, 404);
    assert.deepEqual(seen, ["https://relay.test/v0/market/gt/networks/near/trending_pools", "https://api.geckoterminal.com/api/v2/networks/near/trending_pools", "https://relay.test/v0/market/gt/networks/solana/tokens/x"]);
  });
});
