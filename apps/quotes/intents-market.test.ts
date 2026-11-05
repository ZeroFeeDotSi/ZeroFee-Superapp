// Trade's NEAR Intents tab (product decision, 5 Nov; ledger rows 22-23): its list's prices and logos from GeckoTerminal through this
// relay's paid door, never the keyless public API. The relay serves the list's shapes (tokens/multi on every network 1Click
// lists that GeckoTerminal has; CoinGecko coins/markets and market_chart with their own query names), and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS
import { createRelay } from "./relay.mjs";

const APP = "zerofee-app://app";
function market(answer: (url: string) => Response = () => new Response(JSON.stringify({ data: [] }), { status: 200 })) {
  const sent: string[] = [];
  const fetchFn = async (url: string) => { sent.push(url); return answer(url); };
  let t = 1_000_000;
  const relay = createRelay({ key: "k", secret: "s".repeat(32), origins: [APP], market: { gt: { key: "gt-key" }, cg: { key: "cg-key" } }, fetchFn, now: () => t });
  const get = (path: string) => relay(new Request(`https://quotes.example${path}`, { headers: { origin: APP } }), "203.0.113.9");
  return { sent, get, later: (ms: number) => { t += ms; } };
}
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const IDS = Array.from({ length: 103 }, (_, i) => `coin-${i}`).join(",");

test("the NEAR Intents list's shapes pass, to the paid API only", async () => {
  const { sent, get } = market();
  const paths = [
    `/v0/market/gt/networks/eth/tokens/multi/${WETH},0x2260fac5e5542a773aa44fbcfedf7c193bc2c599?include=top_pools`,
    `/v0/market/gt/networks/base/tokens/multi/${WETH}?include=top_pools`,
    "/v0/market/gt/networks/solana/tokens/multi/So11111111111111111111111111111111111111112?include=top_pools",
    "/v0/market/gt/networks/near/tokens/multi/wrap.near,aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near?include=top_pools",
    `/v0/market/gt/networks/arbitrum/tokens/${WETH}?include=top_pools`,
    `/v0/market/gt/networks/polygon_pos/pools/${WETH}/ohlcv/hour?aggregate=1&limit=168&currency=usd&token=base`,
    `/v0/market/cg/coins/markets?vs_currency=usd&ids=${IDS}&per_page=250&page=1&sparkline=false&price_change_percentage=24h`,
    "/v0/market/cg/coins/wrapped-near/market_chart?vs_currency=usd&days=7",
  ];
  for (const p of paths) assert.equal((await get(p)).status, 200, p);
  assert.equal(sent.length, paths.length);
  assert.ok(sent.every((u) => u.startsWith("https://pro-api.coingecko.com/api/v3/")), sent.join("\n"));
  assert.ok(sent[0]!.startsWith(`https://pro-api.coingecko.com/api/v3/onchain/networks/eth/tokens/multi/${WETH},`), "GeckoTerminal's v2 path under /onchain");
});

test("control: anything out of those shapes is a 404 and never reaches CoinGecko", async () => {
  const { sent, get } = market();
  const thirtyOne = Array.from({ length: 31 }, (_, i) => `0x${String(i).padStart(40, "0")}`).join(",");
  for (const p of [
    `/v0/market/gt/networks/eth/tokens/multi/${thirtyOne}`,                          // more than GeckoTerminal's 30
    `/v0/market/gt/networks/fantom/tokens/multi/${WETH}`,                             // a network 1Click doesn't list
    "/v0/market/gt/networks/near/tokens/multi/wrap.near,a..near",
    `/v0/market/gt/networks/eth/tokens/multi/${WETH}/../../../coins/list`,
    "/v0/market/cg/coins/markets?vs_currency=eur&ids=bitcoin",                        // only usd
    "/v0/market/cg/coins/markets?vs_currency=usd&ids=bitcoin&page=2",                 // one page
    "/v0/market/cg/coins/markets?vs_currency=usd&ids=Bitcoin",                        // CoinGecko's ids only
    "/v0/market/cg/coins/markets?vs_currency=usd&ids=bitcoin&order=volume_desc",      // a name it doesn't take
    "/v0/market/cg/coins/markets?vs_currency=usd&ids=bitcoin&ids=ethereum",           // a name twice
    `/v0/market/cg/coins/markets?vs_currency=usd&ids=${Array.from({ length: 251 }, (_, i) => `c${i}`).join(",")}`,
    "/v0/market/cg/coins/bitcoin/market_chart?vs_currency=usd&days=3",
    "/v0/market/cg/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily",
    "/v0/market/cg/coins/markets?vs_currency=usd",                                    // no ids: CoinGecko's whole market
    "/v0/market/cg/coins/bitcoin/market_chart?vs_currency=usd",                       // no days
    "/v0/market/cg/coins/list",
    "/v0/market/cg/coins/bitcoin",
  ]) assert.equal((await get(p)).status, 404, p);
  assert.deepEqual(sent, []);
});

test("a dead or busy upstream after one good answer: the kept list is served (the relay's last answer), never a blank", async () => {
  let fail = false;
  const { sent, get, later } = market(() => (fail ? new Response("", { status: 429 }) : new Response(JSON.stringify([{ id: "bitcoin" }]), { status: 200 })));
  const p = "/v0/market/cg/coins/markets?vs_currency=usd&ids=bitcoin&per_page=250&page=1&sparkline=false&price_change_percentage=24h";
  assert.equal((await get(p)).status, 200);
  assert.equal((await get(p)).status, 200);
  assert.equal(sent.length, 1, "within its minute: the kept answer, CoinGecko not asked again");
  fail = true; later(90_000);
  const r = await get(p);
  assert.equal(r.status, 200, "the plan's 429: the stale answer");
  assert.deepEqual(await r.json(), [{ id: "bitcoin" }]);
  assert.equal(sent.length, 2);
});
