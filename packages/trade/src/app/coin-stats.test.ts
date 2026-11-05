// Test, 4 Nov ("Pump"): the coin page's numbers read "—" for seconds after a tap on a row that had them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statFigures } from "./coin-stats.ts";

const row = { priceUsd: 2, marketCapUsd: 2_000_000, liquidityUsd: 50_000, volume24hUsd: 900_000, createdAt: 1_700_000_000_000 };

test("before the page's own answer, the tapped row's numbers; the worth moves with the price on screen", () => {
  assert.deepEqual(statFigures(undefined, row, 2), { mcap: 2_000_000, liquidityUsd: 50_000, volume24hUsd: 900_000, createdAt: 1_700_000_000_000 });
  assert.equal(statFigures(undefined, row, 3).mcap, 3_000_000);
});

test("the page's own answer wins where it has a number; a chain-only page keeps the row's for the rest", () => {
  const d = { chain: "sol", address: "x", priceUsd: 4, marketCapUsd: 8_000_000, liquidityUsd: 70_000 } as const;
  assert.deepEqual(statFigures(d, row, 4), { mcap: 8_000_000, liquidityUsd: 70_000, volume24hUsd: 900_000, createdAt: 1_700_000_000_000 });
});

test("control: nothing known anywhere stays unknown (the page draws its dash)", () => {
  assert.deepEqual(statFigures(undefined, {}, undefined), {});
});
