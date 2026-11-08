// Audit 10's A9 (8 Nov): the fee-first Sell's button said "Selling as soon as the fee lands…" (an ellipsis busy line,
// rule 2). Now "Sells when the fee lands · 6 s left", counting down from the job's own end. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEE_WAIT, feeWaitLabel, gasJobEndsAt } from "./sale-gas.ts";

test("A9: the waiting Sell says what happens and the time left, no ellipsis (controls: no end known, or past it: the words alone)", () => {
  const at = 1_000_000, ends = gasJobEndsAt(at);
  assert.equal(feeWaitLabel(ends, ends - 6_000), "Sells when the fee lands · 6 s left");
  assert.equal(feeWaitLabel(undefined, at), FEE_WAIT);
  assert.equal(feeWaitLabel(ends, ends + 1), FEE_WAIT, "past the end: never a negative or a frozen figure");
  for (const s of [feeWaitLabel(ends, at), FEE_WAIT]) assert.doesNotMatch(s, /…|\.\.\./, s);
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /Selling as soon as the fee lands/, "the old busy line is gone");
  assert.match(sheet, /const t = setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\);/, "it counts down");
});
