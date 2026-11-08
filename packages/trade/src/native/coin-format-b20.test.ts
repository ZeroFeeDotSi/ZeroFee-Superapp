// Builder QA's item 5, the sheet's side: the Safe's Buy said "About 5.637698 NEAR", "At least 5.581321 NEAR" and "Done.
// 2.706095 NEAR is in your Safe." (6 decimals) while Home, Activity and its page say NEAR to 4 ("253.0275 NEAR"). Now every
// coin figure of the Buy and Sell reads as Home's (format.ts amountOf, cut, never rounded up, so "at least" stays true),
// and no screen shows more than the receipt. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountOf } from "@zerofee/wallet/app/format.ts";
import { NATIVE_COPY as W } from "./words.ts";

test("item 5: the Buy sheet, its least and its receipt say the coin as Home does", () => {
  const body = (() => { const s = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8"); return s.slice(s.indexOf("export function NativeTradeSheet")); })();
  assert.ok(!body.includes("trimAmount("), "no 6-decimal figure on the sheet");
  assert.ok(body.includes("W.about(amountOf(q.amountOut, row.symbol, row.decimals), row.symbol)"));
  assert.ok(body.includes("`${amountOf(q.minOut, row.symbol, row.decimals)} ${row.symbol}`"));
  assert.ok(body.includes("W.boughtIn(view.got ? `${amountOf(view.got, row.symbol, row.decimals)} ${row.symbol}` : null, row.symbol)"));
  assert.equal(W.about(amountOf("5.637698", "NEAR", 24), "NEAR"), "About 5.6376 NEAR");
  assert.equal(W.atLeast(`${amountOf("5.581321", "NEAR", 24)} NEAR`, "32 s"), "At least 5.5813 NEAR · about 32 s", "cut down: the least stays true");
  assert.equal(W.boughtIn(`${amountOf("2.706095", "NEAR", 24)} NEAR`, "NEAR"), "Bought 2.706 NEAR.");
});
