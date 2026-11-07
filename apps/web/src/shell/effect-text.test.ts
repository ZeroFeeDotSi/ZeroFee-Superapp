// the copy review's words for separate steps (7 Nov): an effect row with no "before" says only where it ends, no arrow ("Your Safe
// after", "$1,090.50 in USDC"); every other row keeps "before → after" (control). The phone's sheet draws the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectText } from "./effect-text.ts";

test("an after-only row has no arrow; a before-and-after row keeps it (control); the phone's sheet the same", () => {
  assert.equal(effectText({ token: "Your Safe after", before: "", after: "$1,090.50 in USDC" }), "$1,090.50 in USDC");
  assert.equal(effectText({ token: "NEAR", before: "4.20", after: "4.1907" }), "4.20 → 4.1907");
  const swift = readFileSync(new URL("../../../ios/ZeroFee/NativeSheet.swift", import.meta.url), "utf8");
  assert.ok(swift.includes('Text(e.before.isEmpty ? e.after : "\\(e.before) → \\(e.after)")'));
});
