// QA (3 Nov): Trade's trending showed "ETH · eth.omft.near · NEAR", a contract id as the coin's name. Every row on every
// recorded list (the demo's, through the real market code) has a name that isn't an id; a bridged coin named by its own
// contract reads as the coin it carries; a coin elsewhere calling itself by such an id never borrows that name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { createRecordedFetch } from "./recorded.ts";
import { RECORDED } from "./recorded-data.ts";
import { coinName, isIdLike } from "./map.ts";
import type { ChainId } from "../types.ts";

const T = Date.parse("2026-10-26T00:00:00Z");

test("no row on any recorded list is named by a contract id, an omft or nep141 string, or an address", async () => {
  const f = createRecordedFetch(RECORDED, () => T);
  const m = createMarket({ fetch: f as typeof globalThis.fetch, now: () => T, storage: null, budget: { calls: 1e9, perMs: 60_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 });
  const names: string[] = [];
  for (const chain of [undefined, "sol", "hood", "near"] as (ChainId | undefined)[]) {
    const rows = await (chain ? m.trending(chain) : (m as unknown as { trending: (c?: ChainId) => Promise<{ name: string; symbol: string; address: string }[]> }).trending(undefined));
    for (const r of rows) {
      names.push(`${r.symbol}: ${r.name}`);
      assert.ok(!isIdLike(r.name) && !/omft|nep141/i.test(r.name), `${chain ?? "all"} ${r.symbol}: "${r.name}"`);
    }
  }
  // control: the bridged coins QA saw are on the lists, with their own names
  for (const want of ["ETH: Ether", "XRP: XRP", "TRX: TRON", "SOL: Solana"]) assert.ok(names.includes(want), `${want} in ${names.length} rows`);
});

test("coinName: a bridged coin by its own contract reads as its coin; any other id reads as its symbol; a name stays", () => {
  assert.equal(coinName("eth.omft.near", "ETH", "eth.omft.near", "near"), "Ether");
  assert.equal(coinName("tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", "USDT", "tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", "near"), "Tether");
  assert.equal(coinName("eth.omft.near", "ETH", "So11111111111111111111111111111111111111112", "sol"), "ETH", "a Solana coin calling itself eth.omft.near is not Ether");
  assert.equal(coinName("nep141:wrap.near", "WNEAR", "x.near", "near"), "WNEAR");
  assert.equal(coinName("Doge Pepe", "DOPE", "addr", "sol"), "Doge Pepe", "control: a real name stays");
  assert.equal(coinName("Quantus", "QTC", "qtc.omft.near", "near"), "Quantus", "control: a bridged coin's real name stays");
});
