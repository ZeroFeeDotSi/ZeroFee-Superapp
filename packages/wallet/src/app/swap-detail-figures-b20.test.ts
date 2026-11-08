// Builder QA's item 5 (builder 19's edge, g7-sell-row-page): a Safe Sell's page said "Swapped 78.0993 NEAR for 345.63402
// USDC." under "$345.63": the record's raw figure, five decimals of a cents coin. Now the coin reads as Wallet's rows read
// it (format.ts amountOf: USDC to the cent, other coins to 4 decimals, cut, never rounded up). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { swapDetail } from "./swap-detail.ts";
import type { Chain, Movement, Token } from "../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tokens = new Map<string, Token>([
  [USDC, { id: USDC, symbol: "USDC", decimals: 6, network: "near" } as Token],
  ["nep141:wrap.near", { id: "nep141:wrap.near", symbol: "NEAR", decimals: 24, network: "near" } as Token],
]);
const chains: Chain[] = [{ id: "near", name: "NEAR" } as Chain];
const swap = (o: Partial<Movement>): Movement => ({ id: "safe-send:sim-1", kind: "swap", status: "done", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", explorerUrls: [], private: true, source: "safe", ...o } as Movement);

test("item 5: a Sell's page says the USDC to the cent", () => {
  const line = swapDetail(swap({ from: "nep141:wrap.near", to: USDC, amount: "78.0993", amountOut: "345.63402" }), tokens, chains)!.ended!.line;
  // audit 17's H5 (builder 21): the page's hero is the figure, so a Safe trade's line says the coin side alone, once
  assert.equal(line, "Sold 78.0993 NEAR.");
});

test("item 5: a Buy's page says the coin to 4 decimals, cut", () => {
  const line = swapDetail(swap({ from: USDC, to: "nep141:wrap.near", amount: "25", amountOut: "5.637698123" }), tokens, chains)!.ended!.line;
  assert.equal(line, "Bought 5.6376 NEAR.");
});

test("control: an unknown coin keeps its figure as it came", () => {
  const line = swapDetail(swap({ from: USDC, to: "nep141:unknown.near", amount: "25", amountOut: "12.5" }), tokens, chains)!.ended!.line;
  assert.equal(line, "Bought it.", "no symbol to say it with: no raw figure either");
});
