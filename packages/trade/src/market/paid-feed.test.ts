// QA's Sim crawl (5 Nov): the Trade coin page's chart blank and Buy disabled for 2.5-8 s, and 67
// console errors from a free Solana node's socket (wss://public.rpc.solanavibestation.com) answering its handshake 429.
// Rules 3 and 9 (the branch rules): never wait on a free node. Two fixes, each with its control:
//  1. With the relay's paid door up (sol-proxy.ts), a Solana pool is followed by polling through that door: no free socket.
//  2. The page's Buy opens from the tapped row (buy-button.ts buyCoin): it never waits on the market data or the chart.
// Fake timers only.
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socketMaker, fx, type TestSocket } from "./testing.ts";
import { followSwaps, freeSocketFor } from "./live.ts";
import { closeAllSockets } from "./hub.ts";
import { SOL_PROXY, setSolProxy } from "@zerofee/core/sol-proxy";
import { buyCoin } from "../app/screens/buy-button.ts";
import type { SpotEnv, SpotPool } from "./spot.ts";
import type { CoinRow } from "./types.ts";

const SOL = fx("v1-live-sol"), TRENDING = fx("v1-trending-solana");
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); };
const advance = async (t: TestContext, ms: number, step = 100) => { for (let i = 0; i < ms; i += step) { t.mock.timers.tick(Math.min(step, ms - i)); await flush(); } };
const timers = (t: TestContext) => { t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_790_000_000_000 }); closeAllSockets(); t.after(() => { closeAllSockets(); setSolProxy(null); }); };

const tokenOf = (id: string) => ({ mint: id.replace("solana_", ""), decimals: TRENDING.included.find((i: any) => i.id === id)!.attributes.decimals as number });
const addr = SOL.pools.pumpswap_PUMP_USDC, row = TRENDING.data.find((p: any) => p.attributes.address === addr)!;
const coin = tokenOf(row.relationships.base_token.data.id), quote = tokenOf(row.relationships.quote_token.data.id);
const pool: SpotPool = { chain: "sol", pool: addr, dex: row.relationships.dex.data.id, coin: { address: coin.mint, decimals: coin.decimals }, quote: { address: quote.mint, decimals: quote.decimals, priceUsd: Number(row.attributes.quote_token_price_usd) } };
function env(log: string[]): SpotEnv {
  return {
    nativeUsd: async () => 150,
    rpc: async (_c, method, params: any[]) => {
      log.push(method);
      if (method === "getAccountInfo") { const a = SOL.accounts[params[0]]; if (!a) throw new Error("no account"); return { value: { owner: a.owner, data: [a.data, "base64"] } }; }
      if (method === "getSignaturesForAddress") return [];
      throw new Error("unexpected " + method);
    },
  };
}

describe("the coin page's Solana feed on the paid door", () => {
  it("relay up: no socket to the free node; the pool is polled (through the solRpc, whose first door is the relay's Helius) every round", async (t) => {
    timers(t);
    setSolProxy("https://relay.example/v0/sol/read");
    assert.equal(freeSocketFor("sol"), false);
    const socks: TestSocket[] = [], log: string[] = [];
    const stop = followSwaps(env(log), "sol", coin.mint, pool, () => {}, { pollMs: 3000, now: () => Date.now(), ws: socketMaker(socks), random: () => 0.5 });
    await advance(t, 10_000);
    assert.equal(socks.length, 0, "no free socket, so no 429 handshakes");
    assert.ok(log.filter((m) => m === "getSignaturesForAddress").length >= 3, `polled every round: ${log.join(",")}`);
    stop();
  });
  it("control: no relay (the free build, the mainnet copy): the socket as before; a resting relay too", async (t) => {
    timers(t);
    setSolProxy(null);
    const socks: TestSocket[] = [];
    const stop = followSwaps(env([]), "sol", coin.mint, pool, () => {}, { pollMs: 3000, now: () => Date.now(), ws: socketMaker(socks), random: () => 0.5 });
    await flush();
    assert.equal(socks.length, 1, "the free socket is opened without a paid door");
    stop();
    setSolProxy("https://relay.example/v0/sol/read");
    SOL_PROXY.restUntil = Date.now() + 60_000;
    assert.equal(freeSocketFor("sol"), true, "a resting relay: the socket");
    assert.equal(freeSocketFor("bsc", () => ["x"]), true, "other chains keep their sockets");
  });
});

describe("Buy never waits on the market data or the chart", () => {
  const seed: CoinRow = { chain: "sol", address: coin.mint, symbol: "PUMP", name: "Pump", logoUrl: "https://relay.example/logo.png", priceUsd: 0.004 };
  it("before the page's own read: Buy opens with the tapped row's coin (the sheet reads chain, address, symbol, logo)", () => {
    const c = buyCoin(undefined, seed);
    assert.deepEqual(c && { chain: c.chain, address: c.address, symbol: c.symbol, logoUrl: c.logoUrl }, { chain: "sol", address: coin.mint, symbol: "PUMP", logoUrl: seed.logoUrl });
    const d = { chain: "sol" as const, address: coin.mint, symbol: "PUMP", decimals: 6 };
    assert.equal(buyCoin(d, seed), d, "the page's own read once it is there");
    assert.equal(buyCoin(undefined, { ...seed, symbol: "" }), undefined, "a pasted address nothing named yet waits for the read");
  });
  it("the page's Buy is gated on that coin, not on the read (control: the old gate, !d, was off until the read came)", () => {
    const page = readFileSync(new URL("../app/screens/CoinPage.tsx", import.meta.url), "utf8");
    assert.match(page, /const buyable = buyCoin\(d, seed\);/);
    assert.match(page, /disabled=\{!buyable \|\| !online\} onClick=\{\(\) => buyable && onBuy\(buyable\)\}>Buy</);
    assert.doesNotMatch(page, /disabled=\{!d \|\| !online\}/, "control: the old gate is gone");
    // the sheet it opens reads nothing else of the coin (so the row is enough)
    const sheet = readFileSync(new URL("../app/screens/TradeSheet.tsx", import.meta.url), "utf8");
    assert.deepEqual([...new Set(sheet.match(/\bcoin\.[a-zA-Z]+/g))].sort(), ["coin.address", "coin.chain", "coin.logoUrl", "coin.symbol"]);
  });
});
