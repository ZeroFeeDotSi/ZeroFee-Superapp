// Audit 16's G5 (8 Nov): with NEAR Confidential or NEAR Intents down, the banner and the Status row said "Trades work."
// while the Safe's Buy and Sell on Trade's NEAR Intents tab (a confidential job, builder 15) could not go. Each surface
// now says the truth: the Safe's Buy and Sell can't go; the trades in Hot work. ZeroFee's server too (the Safe's
// Buy and Sell price through it, SHEET_NEEDS.swap). Fails on main: works was "Trades work.".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVICE_EFFECTS, backLine, downLine } from "./services.ts";
import { DOWN_WORDS } from "./status-words.ts";

test("G5: NEAR Confidential, NEAR Intents or ZeroFee's server down: the Safe's Buy and Sell can't go, the trades in Hot work", () => {
  for (const s of ["confidential", "oneclick", "relay"] as const) {
    const e = SERVICE_EFFECTS[s];
    assert.match(e.blocks, /Safe Buy and Sell can't go now\.$/, s);
    assert.doesNotMatch(e.works, /^Trades work/, s);
    assert.match(backLine(s), /Safe Buy and Sell work again\.$/, s);
  }
  assert.equal(downLine("confidential"), "NEAR Confidential is down. Sends, swaps, moves, Safe Buy and Sell can't go now. Trades in Hot work.");
  assert.equal(downLine("oneclick"), "NEAR Intents is down. Sends, swaps, moves, Safe Buy and Sell can't go now. Trades in Hot work.");
  assert.equal(DOWN_WORDS.confidential, "Sends, swaps, moves, Safe Buy and Sell can't go now. Trades in Hot work.");
  assert.equal(DOWN_WORDS.oneclick, DOWN_WORDS.confidential, "Status says what the banner says");
});

test("G5: the Safe's Buy and Sell really need those three (trade NativeScreens reads SHEET_NEEDS.swap)", () => {
  const sheet = readFileSync(new URL("../../trade/src/native/NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(sheet, /useServices\(bridge, SHEET_NEEDS\.swap,/);
  const needs = readFileSync(new URL("../../wallet/src/app/services.ts", import.meta.url), "utf8");
  assert.match(needs, /swap: \["near", "oneclick", "relay", "confidential"\]/);
});
