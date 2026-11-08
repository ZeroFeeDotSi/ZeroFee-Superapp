// Audit 17's H5 (8 Nov): a done Safe Sell's Activity page said its figure twice ("$345.63" and "Swapped 78.0993 NEAR for
// 345.63402 USDC.") and "No receipt link yet." in its own box. The hero is the trade's one figure; the line says the coin
// side once ("Sold 78.0993 NEAR."); a record that ended with no link shows no placeholder line. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chain, Movement, Token } from "../types.ts";
import { movementDollars } from "./format.ts";
import { movementPage } from "./proof.ts";
import { swapDetail } from "./swap-detail.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tok = (tokenId: string, symbol: string, decimals: number, priceUsd: string): Token => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", decimals, priceUsd } as Token);
const tokens = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6, "1")], ["nep141:wrap.near", tok("nep141:wrap.near", "NEAR", 24, "4.43")]]);
const chains: Chain[] = [{ id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR", coins: [] }];
const sell = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:sim-3", kind: "swap", status: "done", from: "nep141:wrap.near", to: USDC, amount: "78.0993", amountOut: "345.63402", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", explorerUrls: [], private: true, source: "safe", ...o } as Movement);

test("H5: a done Safe Sell's page: the figure once (the hero), the coin side once in the line", () => {
  const usd = movementDollars(sell(), tokens)!;
  assert.equal(usd, "$345.63");
  const line = swapDetail(sell(), tokens, chains)!.ended!.line;
  assert.equal(line, "Sold 78.0993 NEAR.", "fails on main: Swapped 78.0993 NEAR for 345.63402 USDC.");
  assert.ok(!line.includes("345.63"), "no second figure");
  const buy = sell({ from: USDC, to: "nep141:wrap.near", amount: "25", amountOut: "5.637698" });
  assert.equal(swapDetail(buy, tokens, chains)!.ended!.line, "Bought 5.6376 NEAR.", "cut toward zero, as Home reads it");
});

test("H5: a done trade with no link shows no placeholder line; one still going says it once", () => {
  assert.equal(movementPage(sell()).noLink, undefined, "fails on main: No receipt link yet. on a done trade");
  assert.equal(movementPage(sell({ status: "moving", amountOut: undefined })).noLink, true, "control: still going");
  const page = readFileSync(new URL("./screens/ActivityDetail.tsx", import.meta.url), "utf8");
  assert.match(page, /\{page\.noLink && !page\.started && <div/, "the page draws only what movementPage says");
});
