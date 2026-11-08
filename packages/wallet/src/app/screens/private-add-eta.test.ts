// Audit 11's B7 (8 Nov, rule 2): Add to Private's made screen said "10 USDC · Job created. · It goes through NEAR
// Confidential." with no time left at +214 ms or +976 ms (the way home's said "About 10 seconds left."). Now its first frame
// counts down from the quote's own time (about 10 s), else Private's measured leg, and its Jobs row counts the same.
// Fails on main: the receipt had no etaSec and the job none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");

test("B7: Add to Private's made screen and its job carry the time left from the first frame [before: none]", () => {
  assert.match(src, /const eta = quote\.etaSeconds && quote\.etaSeconds > 0 \? quote\.etaSeconds : HOME_ETA_SEC;\n\s+setMadeEta\(eta\);/);
  assert.match(src, /title: `Add \$\{what\} to Private`, etaSec: eta,/, "the Jobs row counts down the same");
  assert.match(src, /testid="private-add-made" etaSec=\{madeEta\}/, "the receipt's TimeLeft has a time from its first frame");
});
