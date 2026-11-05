// A price asked again with the same inputs within PRICE_KEPT_MS is the one kept (a retry never waits on 1Click twice);
// after it, or on another bridge, it is asked again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICE_KEPT_MS, keepPrice, keptPrice } from "./price-kept.ts";

test("a kept price answers within its time, on its own bridge only (controls: after it, another key, another bridge)", () => {
  const a = {}, b = {};
  keepPrice(a, "k", 0.31, 1_000);
  assert.equal(keptPrice(a, "k", 1_000 + PRICE_KEPT_MS - 1), 0.31, "within its time: the same price");
  assert.equal(keptPrice(a, "other", 1_500), undefined, "control: another amount is asked");
  assert.equal(keptPrice(b, "k", 1_500), undefined, "control: another bridge is asked");
  assert.equal(keptPrice(a, "k", 1_000 + PRICE_KEPT_MS), undefined, "control: after its time, asked again");
});
