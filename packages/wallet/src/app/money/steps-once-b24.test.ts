// Builder 24, item 2: a job screen says each step once. Move's said "NEAR Confidential moves it. NEAR lands it." over its
// ticking steps ("Then NEAR Confidential moves it." / "Then NEAR lands it in your Safe."), and once done "It went there
// through NEAR Confidential." over the same steps; the Safe's Buy and Sell said "It's in your Safe as USDC." over the
// step "It's in your Safe.". Now the steps are the only place a step is said: Move's who line shows only when the job has
// no steps to draw, and the Safe trade's done line says what happened ("Sold NEAR.", "Bought 5.6376 NEAR."). Send, Swap
// and Add draw no steps, so their one "It goes through NEAR Confidential." line stays. Fails on main 5af9af16b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveReceiptWords } from "./receipt-said.ts";
import { NATIVE_COPY as W } from "../../../../trade/src/native/words.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("Move: with steps on screen, no who line in either tense; with none, it stays", () => {
  const who = "NEAR Confidential moves it. NEAR lands it.";
  const going = moveReceiptWords({ legs: false, rows: false, where: "your Safe", who, steps: true });
  assert.deepEqual(going, { landed: false, head: "Job created.", title: "Moving it to your Safe.", who: null });
  assert.equal(moveReceiptWords({ legs: true, rows: false, where: "your Safe", who, steps: true }).who, null);
  assert.equal(moveReceiptWords({ legs: false, rows: false, where: "your Safe", who, steps: false }).who, who, "control: no steps, the who line is the only one");
  assert.equal(moveReceiptWords({ legs: true, rows: true, where: "your Safe", who, steps: false }).who, "It went there through NEAR Confidential.");
  const sheet = read("../screens/MoveSheet.tsx");
  assert.match(sheet, /const madeSteps = useJobSteps\(madeJob\);/);
  assert.match(sheet, /steps: madeSteps\.length > 0 \}\);/);
  assert.match(sheet, /\{said\.who && <p className="zf-receipt__line" data-testid="move-made-who">\{said\.who\}<\/p>\}/);
});

test("Safe Buy and Sell: the done line says what happened, never the last step again", () => {
  assert.equal(W.boughtIn("5.6376 NEAR", "NEAR"), "Bought 5.6376 NEAR.");
  assert.equal(W.boughtIn(null, "NEAR"), "Bought NEAR.");
  assert.equal(W.soldIn("NEAR"), "Sold NEAR.");
  for (const s of [W.boughtIn("5.6376 NEAR", "NEAR"), W.soldIn("NEAR")]) assert.doesNotMatch(s, /in your Safe/, "the step \"It's in your Safe.\" says where");
  const page = read("../../../../trade/src/native/NativeScreens.tsx");
  assert.match(page, /W\.soldIn\(row\.symbol\)/);
});

test("Send, Swap and Add draw no steps: their one protocol line is not a repeat", () => {
  for (const f of ["./SendSheet.tsx", "./SwapSheet.tsx", "../screens/Private.tsx"]) assert.doesNotMatch(read(f), /<JobReceipt[^\n]*steps=/, f);
});
