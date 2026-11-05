// Swap directions (5 Nov): the Safe's NEAR → its USDC (route "safe", E7) was offered from $2.00, but its move home needs
// $2 of what came in (trade float-two.ts MIN_USD): under $2.09 it passed Face ID and stopped in the NEAR wallet. The sheet
// now holds it to SAFE_LEG_MIN_USD, as the core does (spending.ts safeSwapLeast). Controls for every other route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { floorOf, routeOf, swapBlock, SWAP_WORDS } from "./swap-corridor.ts";

const PROOF = (c: "bsc" | "pair") => c === "pair";

test("E7 at $2.00 and $2.08 is blocked before the tap with its least; $2.09 goes (control)", () => {
  const r = routeOf("safe-near", "safe-usdc", PROOF)!;
  assert.deepEqual(r, { kind: "safe" });
  assert.deepEqual(floorOf(r), { usd: SAFE_LEG_MIN_USD, line: SWAP_WORDS.leastInSafe, under: SWAP_WORDS.safeSwapLeast });
  for (const usd of [2, 2.08]) assert.equal(swapBlock({ route: r, usd, most: 100 }), SWAP_WORDS.safeSwapLeast, `$${usd}`);
  assert.equal(swapBlock({ route: r, usd: 2.09, most: 100 }), null, "control: at its least it goes");
  assert.match(SWAP_WORDS.leastInSafe, /\$2\.09/);
});

test("controls: the other routes keep their own floors ($2 for the NEAR wallet's cash, $2.09 Safe → a wallet), and E7 stays hidden without the proof build", () => {
  assert.equal(swapBlock({ route: routeOf("near", "safe-usdc", PROOF), usd: 2, most: 100 }), null, "the NEAR wallet's cash home: $2 goes");
  assert.equal(swapBlock({ route: routeOf("safe-usdc", "sol", PROOF), usd: 2.08, most: 100 }), SWAP_WORDS.safeSwapLeast);
  assert.equal(swapBlock({ route: routeOf("safe-usdc", "near", PROOF), usd: 2, most: 100 }), null, "the Safe → the NEAR wallet: $2 goes");
  assert.equal(routeOf("safe-near", "safe-usdc", () => false), null);
  assert.equal(routeOf("safe-usdc", "safe-near", PROOF), null, "no route lands NEAR in the Safe");
});
