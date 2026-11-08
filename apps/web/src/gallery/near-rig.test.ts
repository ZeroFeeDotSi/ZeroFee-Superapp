// S6's Sim shot (QA 16, 8 Nov): the Sim's NEAR wallet starts with nothing, so a Sell short of its fee never showed "Sell ·
// $2.50 for fees first". `?demo&near=5` (dev only, never the public build) starts it with $5, read by the float's balance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFloatMock } from "@zerofee/shell-api/mock-float.ts";

test("?demo&near=N: dev only, capped, handed to the float as its start; the float's balance says it", () => {
  const src = readFileSync(new URL("./Screens.tsx", import.meta.url), "utf8");
  assert.match(src, /const NEAR_START = PUBLIC_BUILD \? 0 : Math\.min\(50, Math\.max\(0, Number\(new URLSearchParams\(location\.search\)\.get\("near"\)\) \|\| 0\)\);/);
  assert.match(src, /float: \{ priceUsd: \(c\) => RECORDED_COIN_USD\[c\], \.\.\.\(NEAR_START > 0 \? \{ startUsd: NEAR_START \} : \{\}\), /);
  const m = createFloatMock({ startUsd: 5 }, () => [], () => false);
  assert.equal((m.answer("subwallet.float.balance", {}) as { usd: number }).usd, 5);
});
