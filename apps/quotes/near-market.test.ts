// TN1 (2 Nov 2026): the relay serves Trade's NEAR market shapes (GeckoTerminal's `near` network: a coin is its contract
// account, a pool is Rhea's or NEAR Intents'), and still nothing else: no "..", no other network, no other query.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { logoRequestOk } from "./logo.mjs";

const APP = "zerofee-app://app";
function market() {
  const sent: string[] = [];
  const fetchFn = async (url: string) => { sent.push(url); return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
  const relay = createRelay({ key: "k", secret: "s".repeat(32), origins: [APP], market: { gt: { key: "gt-key" }, cg: { key: "cg-key" } }, fetchFn });
  const get = (path: string) => relay(new Request(`https://quotes.example${path}`, { headers: { origin: APP } }), "203.0.113.9");
  return { sent, get };
}

test("NEAR: trending, a coin, its info and price, a Rhea or Intents pool, its candles and its trades pass", async () => {
  const { sent, get } = market();
  const pools = ["refv1-6065", "refv2-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1:qtc.omft.near:2000", "nep141:wrap.near___nep141:zec.omft.near"];
  const paths = [
    "/v0/market/gt/networks/near/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1",
    "/v0/market/gt/search/pools?query=qtc&network=near&include=base_token&page=1",
    "/v0/market/gt/networks/near/tokens/qtc.omft.near?include=top_pools",
    "/v0/market/gt/networks/near/tokens/blackdragon.tkn.near/info",
    "/v0/market/gt/simple/networks/near/token_price/qtc.omft.near,wrap.near",
    ...pools.map((p) => `/v0/market/gt/networks/near/pools/${p}`),
    ...pools.map((p) => `/v0/market/gt/networks/near/pools/${p}/ohlcv/minute?aggregate=1&limit=60&currency=usd&token=qtc.omft.near`),
    ...pools.map((p) => `/v0/market/cg/onchain/networks/near/pools/${p}/trades?trade_volume_in_usd_greater_than=1000`),
  ];
  for (const p of paths) assert.equal((await get(p)).status, 200, p);
  assert.equal(sent.length, paths.length);
  assert.ok(sent.every((u) => u.startsWith("https://pro-api.coingecko.com/api/v3/")), sent.join("\n"));
});

test("S13: each chain's New list and NEAR's Rhea pools (3 pages) pass, kept 30 s, to CoinGecko's keyed door", async () => {
  const { sent, get } = market();
  const q = "?include=base_token%2Cquote_token%2Cdex&page=";
  const paths = [
    ...["solana", "bsc", "robinhood", "near"].map((n) => `/v0/market/gt/networks/${n}/new_pools${q}1`),
    `/v0/market/gt/networks/near/new_pools${q}2`,
    ...[1, 2, 3].map((n) => `/v0/market/gt/networks/near/dexes/rhea-finance/pools${q}${n}`),
  ];
  for (const p of paths) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("cache-control") ?? "", /s-maxage=30\b/, p);
  }
  assert.equal(sent.length, paths.length);
  assert.ok(sent.every((u) => u.startsWith("https://pro-api.coingecko.com/api/v3/onchain/networks/")), sent.join("\n"));
  assert.ok(sent.some((u) => u.includes("/onchain/networks/near/dexes/rhea-finance/pools?") && u.includes("page=3")), sent.join("\n"));
});

test("NEAR: a path out of the shapes is a 404 and never reaches CoinGecko", async () => {
  const { sent, get } = market();
  for (const p of [
    "/v0/market/gt/networks/near/tokens/../../coins/list",
    "/v0/market/gt/networks/near/tokens/qtc..near",
    "/v0/market/gt/networks/near/tokens/.qtc.near",
    "/v0/market/gt/networks/near/tokens/QTC.OMFT.NEAR",
    "/v0/market/gt/networks/near/pools/refv1-6065/ohlcv/second",
    "/v0/market/gt/networks/near/pools/nep245:v2_1.omni.hot.tg:56_x___nep141:wrap.near",
    // S13: Rhea's pools by its one dex id only; New lists on Trade's chains only
    "/v0/market/gt/networks/near/dexes/near-intents/pools?page=1",
    "/v0/market/gt/networks/near/dexes/rhea-finance/pools/refv1-6065",
    "/v0/market/gt/networks/near/dexes/rhea-finance/pools?page=1&sort=x",
    "/v0/market/gt/networks/near/dexes/../pools",
    "/v0/market/gt/networks/near/dexes",
    "/v0/market/gt/networks/near/pools",
    "/v0/market/gt/networks/eth/new_pools",
    "/v0/market/gt/new_pools",
    "/v0/market/gt/networks/near/new_pools/x",
    "/v0/market/gt/networks/near/tokens/qtc.omft.near?x_cg_pro_api_key=mine",
  ]) assert.equal((await get(p)).status, 404, p);
  assert.deepEqual(sent, []);
});

test("NEAR logos: a contract account only", () => {
  for (const a of ["qtc.omft.near", "wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"]) assert.ok(logoRequestOk("near", a), a);
  for (const a of ["", "a", "..", "a..near", ".a.near", "a.near.", "A.near", "x".repeat(65), "https://x.near"]) assert.ok(!logoRequestOk("near", a), a);
});
