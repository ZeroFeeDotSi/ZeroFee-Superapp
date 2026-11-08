// Audit 16's G6 (8 Nov): Activity said a Safe Sell was "Converted · 79.5101 NEAR to USDC · in your Safe · $352.23" (the
// figure that left) while $351.88 landed, and never named NEAR Confidential. The Safe's Buy and Sell (builder 15: one job
// through NEAR Confidential, a Safe swap with source "safe") say their job's name, the landed figure read off the record
// (amountOut), and "It went through NEAR Confidential.". Fails on main: "Converted", $352.23, no NEAR Confidential.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chain, Movement, Token } from "../types.ts";
import { describe, movementDollars, safeTrade } from "./format.ts";
import { swapDetail } from "./swap-detail.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tok = (tokenId: string, symbol: string, decimals: number, priceUsd: string): Token => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", decimals, priceUsd } as Token);
const tokens = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6, "1")], ["nep141:wrap.near", tok("nep141:wrap.near", "NEAR", 24, "4.43")]]);
const chains: Chain[] = [{ id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR", coins: [] }];
const sell = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:sim-1", kind: "swap", status: "done", from: "nep141:wrap.near", to: USDC, amount: "79.5101", amountOut: "351.889", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", explorerUrls: [], private: true, source: "safe", ...o } as Movement);
const buy = (o: Partial<Movement> = {}): Movement => sell({ from: USDC, to: "nep141:wrap.near", amount: "25", amountOut: "5.637698", ...o });

test("G6: a Safe Sell that landed: its job's name, the landed figure once, NEAR Confidential named", () => {
  const d = describe(sell(), tokens, chains);
  assert.equal(d.title, "Sell of NEAR", "fails on main: Converted");
  assert.equal(d.detail, "It went through NEAR Confidential.");
  assert.equal(movementDollars(sell(), tokens), "$351.88", "fails on main: $352.23, the figure that left");
});

test("G6: a Safe Buy that landed says the coin it got, at the coin's price, cents down", () => {
  const d = describe(buy(), tokens, chains);
  assert.equal(d.title, "Buy of NEAR");
  assert.equal(d.detail, "It went through NEAR Confidential.");
  assert.equal(movementDollars(buy(), tokens), "$25.00", "audit 17 H4: what it paid, the receipt's figure (was $24.97: 5.637698 NEAR at $4.43)");
  assert.equal(safeTrade(buy()), "buy");
});

test("G6: going, it says the step; its page still names both coins", () => {
  const d = describe(sell({ status: "moving", amountOut: undefined }), tokens, chains);
  assert.equal(d.title, "Selling NEAR");
  assert.equal(d.detail, "It goes through NEAR Confidential.");
  assert.equal(movementDollars(sell({ status: "moving", amountOut: undefined }), tokens), "$352.23", "going: what left");
  // audit 17's H5: the page's hero is its one figure, so its line says the coin side alone, once
  assert.match(swapDetail(sell(), tokens, chains)!.ended!.line, /^Sold 79\.5101 NEAR\.$/);
});

test("control: Home's swap in place and a public convert keep their words", () => {
  assert.equal(safeTrade(sell({ source: "private" })), null);
  assert.equal(safeTrade(sell({ private: false })), null);
  assert.equal(describe(sell({ source: undefined, private: false }), tokens, chains).title, "Converted");
  assert.equal(describe(sell({ status: "problem" }), tokens, chains).title !== "Sell of NEAR", true, "a stopped one keeps the problem's head");
});
