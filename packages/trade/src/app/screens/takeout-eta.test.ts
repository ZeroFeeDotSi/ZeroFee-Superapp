// Test (public Sim, 5 Nov): Take out said "Back in your Safe in about 2 minutes." and landed in 10 s. The sheet's
// line was typed by hand while its own job counts down LEG_SEC.nearToSafe (10 s, the NEAR wallet → Safe leg). Now the
// line reads the same leg time as the job. Control: the job still uses that leg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./AddTakeOut.tsx", import.meta.url), "utf8");

test("Take out's line says the time its own job counts down (control: the job's eta is the same leg)", () => {
  assert.match(src, /Back in your Safe in \{about\(LEG_SEC\.nearToSafe\)\}\./);
  assert.doesNotMatch(src, /Back in your Safe in about 2 minutes/, "the hand-typed time is gone");
  assert.match(src, /title: `Move \$\{amount\} to your Safe`, usd: amount, etaSec: LEG_SEC\.nearToSafe/, "control: the job counts down the same leg");
});
