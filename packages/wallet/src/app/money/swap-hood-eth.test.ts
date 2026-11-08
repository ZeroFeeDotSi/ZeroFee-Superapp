// Audit 11's B5 (8 Nov): Swap SOL wallet -> Robinhood wallet said "Swapping SOL for Robinhood." and, landed, "About 24.4999
// USDC is in your Robinhood wallet." (the move's first leg, USDC on NEAR, not the ETH that came in). Now the coin is ETH,
// and the landed line reads the last leg that landed in the coin the sheet promised, with no "About" once it is read.
// Fails on main: "Robinhood"; the USDC figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { SWAP_COIN, coinName } from "./swap-corridor.ts";
import { landedFigure } from "./swap-follow.ts";
import { swappedLine, swappingLine } from "./receipt-said.ts";

const fig = (n: number) => String(Number(n.toFixed(4)));
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv", kind: "move", usd: "25.00", status: "done", shown: true, atIso: new Date().toISOString(), words: "Moved $25.00", ...o } as SpendingActivity);

test("B5: the Robinhood wallet's coin is ETH on the sheet and in its going line [before: \"Robinhood\"]", () => {
  assert.equal(SWAP_COIN.hood.label, "ETH");
  assert.equal(coinName("hood"), "ETH · your Robinhood wallet");
  assert.equal(swappingLine(SWAP_COIN.sol.label, SWAP_COIN.hood.label), "Swapping SOL for ETH.");
});

test("B5: the landed line reads the leg that landed in the promised coin, said as read [before: About 24.4999 USDC]", () => {
  const rows = [row({ amountOut: { amount: "24.4999", symbol: "USDC" } }), row({ id: "leg2", of: "mv", amountOut: { amount: "0.0101", symbol: "ETH" } })];
  const f = landedFigure(rows, "mv", fig, "ETH");
  assert.equal(f, "0.0101 ETH");
  assert.equal(swappedLine(f!, SWAP_COIN.hood.where, true), "0.0101 ETH is in your Robinhood wallet.");
  // only a USDC figure on record: nothing read, the tap's estimate stays
  assert.equal(landedFigure([rows[0]!], "mv", fig, "ETH"), null);
  // control: a move home lands USDC in the Safe, read as before
  assert.equal(landedFigure([row({ amountOut: { amount: "4.86", symbol: "USDC" } })], "mv", fig, "USDC"), "4.86 USDC");
  assert.equal(swappedLine("0.2419 SOL", "your SOL wallet"), "About 0.2419 SOL is in your SOL wallet.", "control: the tap's estimate keeps About");
});
