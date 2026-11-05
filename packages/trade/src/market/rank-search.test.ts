// A search's rows, best first (AgentZero's suite, 3 Nov: "Buy $5 of WIF" found two Robinhood Chain copies and no
// dogwifhat). The figures are GeckoTerminal's own answer to "WIF" on 3 Nov (liquidity and the day's volume, rounded).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSearch, tickerOf } from "./map.ts";
import type { CoinRow } from "./types.ts";

const row = (chain: CoinRow["chain"], address: string, symbol: string, liquidityUsd: number, volume24hUsd: number): CoinRow => ({ chain, address, symbol, name: symbol, liquidityUsd, volume24hUsd });
const WIF_ANSWER: CoinRow[] = [
  // the order the old merge gave: one chain, then the other
  row("hood", "0xaaa1", "WIF", 106_326, 118_363),
  row("sol", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "$WIF", 4_972_190, 499_975),
  row("hood", "0xaaa2", "WIF", 35_924, 4_389),
  row("sol", "wifbear", "WIFBEAR", 9_424, 1_990_034),
  row("sol", "wifout", "WIFOUT", 29_466, 7_186),
];

test("\"WIF\" puts dogwifhat ($WIF on Solana, $5M in its market) first; the Robinhood Chain WIFs come after it, marked as its copies (control: a coin with another ticker is never a copy)", () => {
  const out = rankSearch(WIF_ANSWER, "WIF");
  assert.equal(out[0]!.address, "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");
  assert.equal(out[0]!.copycatOf, undefined);
  const copies = out.filter((r) => r.copycatOf);
  assert.deepEqual(copies.map((r) => r.address), ["0xaaa1", "0xaaa2"]);
  assert.ok(copies.every((r) => r.copycatOf!.address === out[0]!.address && r.copycatOf!.chain === "sol"));
  assert.deepEqual(out.slice(0, 3).map((r) => tickerOf(r.symbol)), ["WIF", "WIF", "WIF"], "the ticker typed comes before WIFBEAR and WIFOUT");
  assert.equal(out.find((r) => r.symbol === "WIFBEAR")!.copycatOf, undefined, "control");
});

test("a ticker's own deeper coin on another chain is not called a copy when they're close in size (control: under a tenth is)", () => {
  const out = rankSearch([row("sol", "a", "PEPE", 1_000_000, 10), row("hood", "b", "PEPE", 200_000, 10), row("bsc", "c", "PEPE", 50_000, 10)], "pepe");
  assert.deepEqual(out.map((r) => [r.address, !!r.copycatOf]), [["a", false], ["b", false], ["c", true]]);
});

test("the ticker as typed: a leading $ and the case don't matter", () => {
  assert.equal(tickerOf("$wif"), "WIF");
  assert.equal(tickerOf("  BONK "), "BONK");
});
