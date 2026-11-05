// Finding 46 (crawl, 4 Nov): pump.fun's wallet showed "$2.47" in Bonk under a greyed Take out, with no reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { takeOutWhy } from "./site-wallet.ts";

const bonk = { network: "sol", name: "Bonk", symbol: "BONK", dollars: "$2.47" };
const base = { name: "pump.fun", canTakeOut: false, wallet: true, moving: false, sol: 0.01 };

test("finding 46: a greyed Take out says why: a coin to sell for SOL first, or too little SOL", () => {
  assert.equal(takeOutWhy({ ...base, coins: [bonk] }), "Take out moves only SOL. Sell your BONK for SOL on pump.fun first.");
  assert.equal(takeOutWhy({ ...base, coins: [] , sol: 1.2 }), "Take out needs $2 of SOL. This wallet has $1.20.");
});

test("finding 46 controls: nothing said when Take out works, nothing is in it, or an Add is on its way", () => {
  assert.equal(takeOutWhy({ ...base, canTakeOut: true, coins: [bonk] }), null);
  assert.equal(takeOutWhy({ ...base, coins: [], sol: 0 }), null);
  assert.equal(takeOutWhy({ ...base, moving: true, coins: [bonk] }), null);
  assert.equal(takeOutWhy({ ...base, wallet: false, coins: [bonk] }), null);
});
