import { test } from "node:test";
import assert from "node:assert/strict";
import { pageRefusal } from "./coin-refusal.ts";

test("an EVM coin whose sell check every recent holder failed shows no Buy; a warning or an unknown keeps it", () => {
  assert.equal(pageRefusal("bsc", { checks: { level: "warn", notes: [], cantSell: true } }), "unsellable");
  assert.equal(pageRefusal("hood", { checks: { level: "warn", notes: [], cantSell: true } }), "unsellable");
  assert.equal(pageRefusal("bsc", { checks: { level: "warn", notes: ["It still has an owner"] } }), undefined);
  assert.equal(pageRefusal("bsc", { checks: { level: "unknown", notes: [] } }), undefined);
  assert.equal(pageRefusal("hood", {}), undefined, "checks not read yet: Buy stays");
});

test("Solana: the mint's own answer first, then the market's freeze flag", () => {
  assert.equal(pageRefusal("sol", { mint: "hooked", freezeFlag: true }), "hooked");
  assert.equal(pageRefusal("sol", { freezeFlag: true }), "freezable");
  assert.equal(pageRefusal("sol", {}), undefined);
  assert.equal(pageRefusal("sol", { checks: { level: "warn", notes: [], cantSell: true } }), undefined, "EVM checks never read on Solana");
});
