// Audit 11's B6 (8 Nov): a Safe Swap that Private pays whole turned its pay card from "USDC · Your Safe · $1,385.60" to
// "USDC · Private · $33.86": all of Private (USDC $25.00 + NEAR $8.86) under the USDC coin. The figure under a coin is that
// coin's. Fails on main: no privateCoinFigure; the card read Private's whole figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateCoinFigure, privateFigure } from "../format.ts";
import { swapPayer } from "./paid-from.ts";
import type { Balance } from "../../types.ts";

const bal = (symbol: string, usd: string): Balance => ({ tokenId: symbol === "NEAR" ? "near" : `nep141:${symbol.toLowerCase()}`, symbol, usd, amount: usd } as unknown as Balance);
const pocket = { available: true, ready: true, rows: [bal("USDC", "25.00"), bal("NEAR", "8.86")] };

test("B6: Private's pay card under USDC shows Private's USDC, $25.00, never all of Private ($33.86) [before: $33.86]", () => {
  assert.equal(privateFigure(pocket), "33.86", "control: Private's whole figure is still the one figure elsewhere");
  assert.equal(privateCoinFigure(pocket, "USDC"), "25.00");
  assert.equal(privateCoinFigure(pocket, "NEAR"), "8.86");
  assert.equal(privateCoinFigure({ ...pocket, ready: false }, "USDC"), null, "not read: no figure");
  const p = swapPayer({ safeRoute: true, signs: false, where: "your Safe", usd: 1385.6, privateUsd: privateCoinFigure(pocket, "USDC") });
  assert.deepEqual(p, { where: "Private", usd: 25, private: true });
  assert.match(readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8"), /privateUsd: privateCoinFigure\(pocket, SWAP_COIN\[pay\.place\]\.symbol\)/);
});
