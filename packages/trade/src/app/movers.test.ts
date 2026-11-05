import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoinRow } from "../market/types.ts";
import { changeIn, homeTrending, moversOf } from "./movers.ts";

test("audit 2 Nov: Home's trending is the Trade tab's own list: chains Trade offers only, no Solana coin Buy refuses", () => {
  const r = (chain: CoinRow["chain"], address: string): CoinRow => ({ chain, address, symbol: address, name: address });
  const list = [r("sol", "S1"), r("bsc", "B1"), r("hood", "H1"), r("sol", "FROZEN"), r("sol", "S2"), r("hood", "H2"), r("sol", "S3")];
  assert.deepEqual(homeTrending(list, ["sol", "hood"], new Set(["FROZEN"]), 4).map((x) => x.address), ["S1", "H1", "S2", "H2"]);
  assert.deepEqual(homeTrending(list, ["sol"], new Set(), 9).map((x) => x.address), ["S1", "FROZEN", "S2", "S3"]);
});

const row = (symbol: string, changePct: CoinRow["changePct"], change24hPct?: number): CoinRow => ({ chain: "sol", address: symbol, symbol, name: symbol, changePct, ...(change24hPct !== undefined ? { change24hPct } : {}) });
const rows = [row("A", { m5: 1, h1: 9, h24: -3 }, -3), row("B", { m5: 4, h1: -2, h24: 40 }, 40), row("C", { h1: 5 })];

test("Trending keeps GeckoTerminal's own order; a window sorts by that window's rise, biggest first; a coin with no figure for it isn't listed", () => {
  assert.deepEqual(moversOf(rows, "trending").map((r) => r.symbol), ["A", "B", "C"]);
  assert.deepEqual(moversOf(rows, "h1").map((r) => r.symbol), ["A", "C", "B"]);
  assert.deepEqual(moversOf(rows, "m5").map((r) => r.symbol), ["B", "A"]);
  assert.deepEqual(moversOf(rows, "h24").map((r) => r.symbol), ["B", "A"]);
});

test("a coin down 100% in a day has no market left: no list shows it (Trending keeps the rest in its own order)", () => {
  const dead = [row("A", { h1: 2 }, -3), row("UHI", { h1: 0, m5: 0 }, -100), row("B", { h1: 1 }, -62)];
  assert.deepEqual(moversOf(dead, "trending").map((r) => r.symbol), ["A", "B"]);
  assert.deepEqual(moversOf(dead, "h1").map((r) => r.symbol), ["A", "B"]);
});

test("each row shows the change for the window picked (the day's for Trending and 24h)", () => {
  assert.equal(changeIn(rows[0]!, "m5"), 1);
  assert.equal(changeIn(rows[0]!, "trending"), -3);
  assert.equal(changeIn(rows[2]!, "h6"), undefined);
});
