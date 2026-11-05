import { test } from "node:test";
import assert from "node:assert/strict";
import { SCAN, tooSmall } from "./scan.ts";

test("grade 02f, F4: a 33×15 inline link is too small; 44×44 and bigger pass (M6, no inline exception)", () => {
  assert.equal(tooSmall({ width: 33, height: 15 }), true, "Security Activity's 'See it' link, which the old scanner passed");
  assert.equal(tooSmall({ width: 166, height: 38 }), true, "the Cancelled screen's explorer link");
  assert.equal(tooSmall({ width: 20, height: 20 }), true, "control: the injected 20×20 button");
  assert.equal(tooSmall({ width: 44, height: 44 }), false);
  assert.equal(tooSmall({ width: 358, height: 64 }), false, "a whole Activity row");
  assert.equal(tooSmall({ width: 43.6, height: 43.6 }), false, "half a pixel of rounding");
});

test("the in-page scan is built on the same rule, parses, and keeps no inline exception", () => {
  assert.ok(SCAN.includes("tooSmall(r)"));
  assert.ok(!/display === "inline"/.test(SCAN), "the inline pass that hid the 33×15 links is gone");
  assert.doesNotThrow(() => new Function(`return ${SCAN.replace(/^\(\(\) => \{/, "() => {").replace(/\}\)\(\)$/, "}")}`));
});
