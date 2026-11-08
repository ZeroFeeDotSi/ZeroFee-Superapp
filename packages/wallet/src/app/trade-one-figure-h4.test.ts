// Audit 17's H4 (8 Nov): one Sell said $200.86 (done screen), $200.66 (its landed line) and $200.65 (Activity); one Buy said
// $25.00 on its receipt and $24.97 on its Activity row (its NEAR at today's price). One trade has one dollar figure, its
// USDC side, read off one record field with one formatter (format.ts tradeUsd / landedUsd). Fails on main: $24.97.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Movement, Token } from "../types.ts";
import { landedUsd, movementDollars, tradeUsd } from "./format.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tok = (tokenId: string, symbol: string, decimals: number, priceUsd: string): Token => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", decimals, priceUsd } as Token);
const tokens = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6, "0.9996")], ["nep141:wrap.near", tok("nep141:wrap.near", "NEAR", 24, "2.5719")]]);
// sent and landed differ: 78.1 NEAR left (about $200.86 asked), 200.659 USDC landed
const sell = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:sim-2", kind: "swap", status: "done", from: "nep141:wrap.near", to: USDC, amount: "78.1", amountOut: "200.659", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", explorerUrls: [], private: true, source: "safe", ...o } as Movement);
const buy = (o: Partial<Movement> = {}): Movement => sell({ from: USDC, to: "nep141:wrap.near", amount: "25", amountOut: "9.7088", ...o });

test("H4: a Sell's one figure is what landed, the same on every screen", () => {
  assert.equal(tradeUsd(sell()), "$200.65");
  assert.equal(movementDollars(sell(), tokens), "$200.65", "Activity's row");
  assert.equal(landedUsd("200.659"), "$200.65", "the done screen's and the Jobs row's formatter");
});

test("H4: a Buy's one figure is what it paid, never its coin at today's price", () => {
  assert.equal(movementDollars(buy(), tokens), "$25.00", "fails on main: $24.97");
  assert.equal(movementDollars(buy({ status: "moving", amountOut: undefined }), tokens), "$25.00", "going too, even with USDC at $0.9996");
});

test("control: a Sell still going says what left; a move that is not a Safe trade is untouched", () => {
  assert.equal(tradeUsd(sell({ status: "moving", amountOut: undefined })), null);
  assert.equal(tradeUsd({ ...sell(), source: undefined } as Movement), null);
  assert.equal(landedUsd("0.004"), "under $0.01");
});
