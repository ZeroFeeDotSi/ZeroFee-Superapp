// The crawl (4 Nov): "Buy $1.00 of X" on the task, $1.15 on the row. The title stays the ask; the detail adds the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { landedDetail, whenCosted } from "./landed-detail.ts";

test("a fresh coin's buy: the task's detail says the chain's extra once it is read (controls: not read yet, only the time; no extra, only the time; a sale, its one figure)", () => {
  const buy = { kind: "buy", amountUsd: 1.15, costs: {}, quote: { payUsd: 1 } };
  assert.equal(landedDetail("0.90 s", buy, "Solana"), "Landed in 0.90 s · Plus $0.15 for Solana");
  assert.equal(landedDetail("0.90 s", { ...buy, costs: undefined }, "Solana"), "Landed in 0.90 s");
  assert.equal(landedDetail("0.90 s", { ...buy, amountUsd: 1.004 }, "Solana"), "Landed in 0.90 s");
  // test (Sell cents): a sale says its one figure, the coins' part (trade-usd.ts), never its in-all net of the fee
  assert.equal(landedDetail("0.90 s", { kind: "sell", amountUsd: 12.4238, costs: { coinUsd: 12.4258, feeUsd: 0.002 }, quote: { payUsd: 1 } }, "Solana"), "Landed in 0.90 s · $12.42", "a sale: proceeds less the fee, the button's figure (test, trade-usd.ts)");
});

test("whenCosted: told once the check books the chain's figure, then it stops listening (control: already costed, at once)", () => {
  const fs = new Set<() => void>();
  const on = (f: () => void) => (fs.add(f), () => void fs.delete(f));
  const rec: { costs?: object } = {};
  let told = 0;
  whenCosted(on, rec, () => told++, 50);
  fs.forEach((f) => f());
  assert.equal(told, 0, "not yet");
  rec.costs = {};
  [...fs].forEach((f) => f());
  assert.equal(told, 1);
  assert.equal(fs.size, 0, "stopped");
  whenCosted(on, rec, () => told++);
  assert.equal(told, 2);
});
