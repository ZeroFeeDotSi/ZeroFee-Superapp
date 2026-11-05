import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTrades, SHOWN_TRADES, tradeSide } from "./trades-list.ts";

const row = (tx: string, t: number, usd = 50) => ({ tx, t, usd, priceUsd: 1, side: "buy" as const });

test("a swap that lands goes on top; the 15 s read fills in behind it; one row per transaction", () => {
  const read = [row("a", 100), row("b", 90)];
  assert.deepEqual(mergeTrades([row("new", 200)], read).map((r) => r.tx), ["new", "a", "b"]);
  assert.deepEqual(mergeTrades([row("a", 100)], read).map((r) => r.tx), ["a", "b"], "the read listing a landed swap again: once");
  assert.deepEqual(mergeTrades([], undefined), []);
  assert.equal(mergeTrades(Array.from({ length: 30 }, (_, i) => row(`x${i}`, i)), read).length, SHOWN_TRADES);
});

test("Whales filters what lands too, not only the read", () => {
  const out = mergeTrades([row("small", 300, 40), row("big", 290, 2_500)], [row("r-big", 100, 1_200), row("r-small", 90, 900)], 1_000);
  assert.deepEqual(out.map((r) => r.tx), ["big", "r-big"]);
});

test("B: a swap not yet confirmed shows (faded on the page) but never in Whales; its confirmed copy replaces it; dropped, it's gone", async () => {
  const { landedWith, landedWithout } = await import("./trades-list.ts");
  const pending = { ...row("s1", 500, 3_000), unconfirmed: true as const };
  assert.deepEqual(mergeTrades([pending], []).map((r) => [r.tx, !!r.unconfirmed]), [["s1", true]]);
  assert.deepEqual(mergeTrades([pending], [], 1_000), [], "not in Whales until confirmed");
  const solid = landedWith([pending], row("s1", 500, 3_000));
  assert.deepEqual(solid.map((r) => [r.tx, !!r.unconfirmed]), [["s1", false]], "one row, now solid");
  assert.deepEqual(mergeTrades(solid, [], 1_000).map((r) => r.tx), ["s1"]);
  assert.deepEqual(landedWithout([pending, row("x", 400)], "s1").map((r) => r.tx), ["x"]);
});

test("a swap not final yet says it is still going through: Buying / Selling, never \"Bought … confirming\" (controls: final ones)", async () => {
  assert.equal(tradeSide({ side: "buy", unconfirmed: true }), "Buying");
  assert.equal(tradeSide({ side: "sell", unconfirmed: true }), "Selling");
  assert.equal(tradeSide({ side: "buy" }), "Bought");
  assert.equal(tradeSide({ side: "sell" }), "Sold");
  const page = (await import("node:fs")).readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /"confirming"\s*:/, "the coin page's trade rows never say confirming");
  assert.match(page, /tradeSide\(t\)/);
});
