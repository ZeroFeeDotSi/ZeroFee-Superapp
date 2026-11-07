// the audit's Send audit M1 (7 Nov): Max on Send showed three figures for one send. Safe USDC can-send 9.996512, tap Max: the
// button and From said "$9.99" (centsDown), the pending sheet, Jobs row and receipt "$10.00" (SendSheet's a.usd.toFixed(2)),
// the Face ID sheet and Activity "$9.61" (the core's maxSend pays 9.61165). Now the most one send pays is worked once at
// the source (send-sources.ts sendable, the core's own maxSend) and every line reads that one figure; SendSheet never
// re-rounds. Fails on main: no sendable, SendSheet re-rounds a.usd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maxSend } from "@zerofee/core/inflow-grid";
import { sendable } from "./send-sources.ts";
import { heldWords, overLine, readyUsd, sendFigure } from "./send-cap.ts";

const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");

test("M1: the audit's case, Safe USDC 9.996512 at Max: the one figure is what the core pays, $9.61, on the From row, the at-most line and the button", () => {
  const can = sendable({ max: "9.996512" }, 6);
  assert.equal(can, "9.61165", "the core's own maxSend pays");
  assert.equal(maxSend(9_996_512n, 0n)!.pays, 9_611_650n, "the same function the core's Max path runs (safe-send.ts)");
  const ready = readyUsd(can, 1)!;
  assert.equal(ready, 9.61);
  assert.equal(heldWords({ row: null, symbol: "USDC", amount: "12", usd: "12", max: can }), "USDC · $9.61 ready", "From");
  assert.equal(overLine("your Safe", `$${ready.toFixed(2)}`), "You can send at most $9.61 from your Safe.");
  assert.equal(sendFigure({ typed: null, exact: false, usd: Number(can) * 1 }), "9.61", "the button's figure at Max");
});

test("M1: with a Private part, the same core rule (changed pin, builder 3, 7 Nov: through the fill the core pays the whole Send from the Safe and Private's share stays, send-anywhere.test.ts proves it on the core; the route-open rule, the pocket first, is a Private-only source's)", () => {
  const can = sendable({ max: "9.996512", pocket: "2" }, 6);
  assert.equal(can, "9.61165");
  assert.equal(sendFigure({ typed: null, exact: false, usd: Number(can) }), "9.61");
  assert.equal(sendable({ max: "9.996512", pocket: "2", privateOnly: true }, 6), "7.669902", "the pocket first, the gap on the whole payout");
});

test("M1 controls: decimals unknown, nothing to round, or an empty source: the source's own max", () => {
  assert.equal(sendable({ max: "9.996512" }, undefined), "9.996512");
  assert.equal(sendable({ max: "0" }, 6), "0");
  assert.equal(sendable({ max: "2", pocket: "5" }, 6), "2", "the pocket alone covers it: nothing gridded");
});

test("M1: the form reads the one figure everywhere, Max hands the core the raw max, and the sheet says the form's figure as is", () => {
  assert.match(form, /const can = source \? sendable\(source, decOf\(source\)\) : "0";/);
  assert.match(form, /const atMax = amount === max && can !== max;/);
  assert.match(form, /const over = !exact && !atMax && overMax\(amount, can\);/, "typed over what one send pays is said; Max isn't over");
  assert.match(form, /const readyNow = readyUsd\(can, perCoin\);/);
  assert.match(form, /perCoin !== null \? Number\(atMax \? can : amount\) \* perCoin : null;/);
  assert.match(form, /const figure = sendFigure\(\{ typed: atMax \? null : typed, exact: !!exact, usd \}\);/);
  assert.match(form, /usd, \.\.\.\(figure !== null \? \{ figure \} : \{\}\),/, "the tap hands the sheet the button's figure");
  assert.match(form, /onClick=\{\(\) => \{ setPreset\(true\); slide\(STEPS\); \}\}/, "Max still sets the raw max (the core's Max path)");
  // the sheet: the pending sheet's headline, the Jobs row, the receipt all say the form's figure, never a re-rounded a.usd
  assert.match(sheet, /const figure = a\.figure !== undefined \? Number\(a\.figure\)\.toFixed\(2\) : a\.usd !== null \? a\.usd\.toFixed\(2\) : null;/);
  assert.doesNotMatch(sheet, /\$\{a\.usd\.toFixed\(2\)\}/, "fails before: $10.00 from 9.996512");
  assert.match(sheet, /\.\.\.\(cash !== null \? \{ usd: cash \} : \{\}\), safe: fromSafe,/, "the Jobs row (with its commas, QA 16)");
});
