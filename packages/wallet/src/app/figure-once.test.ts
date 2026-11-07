// the audit's Trade audit T10 (8 Nov): every Home row in Activity said its figure twice: "Move $20.00 to your SOL wallet" beside
// "$20.00", "Send $5.00 to bob.near" beside "$5.00", "Moved $33.86 from Private to your Safe" beside "$33.86". Now the
// row's title drops its figure when the right column says it. Controls: a row with no right figure keeps its title whole;
// a title with no figure is untouched; a coin amount is not a dollar figure. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { figureOnce } from "./activity-rows.ts";

test("T10: a row's title drops its dollar figure when the right column says it", () => {
  assert.equal(figureOnce("Move $20.00 to your SOL wallet", "$20.00"), "Move to your SOL wallet");
  assert.equal(figureOnce("Send $5.00 to bob.near", "$5.00"), "Send to bob.near");
  assert.equal(figureOnce("Moved $33.86 from Private to your Safe", "$33.86"), "Moved from Private to your Safe");
  assert.equal(figureOnce("Add $1,250.00 to your Safe", "$1,250.00"), "Add to your Safe");
  assert.equal(figureOnce("Move about $5.00 to your Safe", "$5.00"), "Move to your Safe", "its about goes with it");
  assert.equal(figureOnce("Swap $5", "$5.00"), "Swap", "a figure at the end");
});

test("T10 controls: no right figure keeps the title; no figure, nothing to drop; a coin amount stays", () => {
  assert.equal(figureOnce("Move $20.00 to your SOL wallet", undefined), "Move $20.00 to your SOL wallet");
  assert.equal(figureOnce("Moved to Private", "$4.00"), "Moved to Private");
  assert.equal(figureOnce("Move stopped", "$20.00"), "Move stopped");
  assert.equal(figureOnce("Moved 0.5 NEAR from your old wallets to your Safe", "$1.60"), "Moved 0.5 NEAR from your old wallets to your Safe");
});

test("T10: both kinds of Activity row draw their title through figureOnce (wiring)", () => {
  const a = readFileSync(new URL("./screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(a, /<div className="t">\{figureOnce\(nameOf\(s\), usd\)\}<\/div>/, "a Spending row");
  assert.match(a, /<div className="t">\{figureOnce\(title, usd\)\}<\/div>/, "a ledger row (a Send, the way home)");
  assert.doesNotMatch(a, /<div className="t">\{(nameOf\(s\)|title)\}<\/div>/, "control: no row title drawn bare");
});
