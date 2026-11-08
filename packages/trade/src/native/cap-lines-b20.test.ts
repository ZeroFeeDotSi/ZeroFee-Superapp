// Builder QA's item 7, audit 12's S6 and S7 (audit 16: both stand): Swap said "Up to $327.46 can go in one swap." under a
// keypad at rest (offline, a service down), a cap on an amount nobody can type; and the NEAR page said "You hold
// 253.027539 NEAR" and "Up to 238.527539 NEAR can go in one sell." beside Home's "253.0275 NEAR". Now no cap line while
// the keypad rests, and the coin page reads a held coin as Home does (format.ts amountOf). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountOf } from "@zerofee/wallet/app/format.ts";
import { NATIVE_COPY as W } from "./words.ts";

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");

test("S6: Swap says no \"Up to ... in one swap\" while its keypad rests", () => {
  const swap = read("packages/wallet/src/app/money/SwapSheet.tsx");
  assert.ok(swap.includes("part: rests ? null : nothing ? SWAP_WORDS.none : pay?.part ?? null"));
  assert.ok(swap.indexOf("const rests =") < swap.indexOf("part: rests ? null"), "rests is read first");
});

test("S7: the coin page says a held coin as Home does: 4 decimals, cut", () => {
  const page = read("packages/trade/src/native/NativeScreens.tsx");
  assert.ok(page.includes("{W.youHold(amountOf(shownHeld.amount, symbol, row?.decimals), symbol)}"));
  assert.ok(page.includes("{W.sellPart(amountOf(held!, symbol, row?.decimals), symbol, figure?.rest)}"));
  assert.equal(W.youHold(amountOf("253.027539", "NEAR", 24), "NEAR"), "You hold 253.0275 NEAR");
  assert.equal(W.sellPart(amountOf("238.527539", "NEAR", 24), "NEAR"), "Up to 238.5275 NEAR can go in one sell.");
});
