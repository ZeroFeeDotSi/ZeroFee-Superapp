// the copy review's ruling (5 Nov) for the phone's Send from Private (the Safe's own route shut, so only Private's part of a Safe coin
// goes): no standing "can't" line; the coin's row carries its figure ("NEAR · $X in Private"); the keypad caps at that
// figure; one line, only when the typed amount was over it: "Private holds $X of NEAR. Send up to that, or pick another
// coin." Each with its control (the Safe's route open keeps "Up to … can go in one send." and "at most" as before).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sendSources } from "./send-sources.ts";
import { overLine, privateCap, privateOver, privateRow } from "./send-cap.ts";
import { SEND_PART } from "./send-words.ts";
import type { Balance } from "../../types.ts";

const WNEAR = "nep141:wrap.near";
const near = (amount: string, usd: string, held: "ledger" | "private"): Balance => ({ tokenId: WNEAR, symbol: "NEAR", chain: "near", amount, usd, held } as Balance);
const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");

test("the copy review's ruling: Send from Private, the coin's row carries Private's figure and no standing can't line (control: the Safe's route open, its own line, no Private figure)", () => {
  const [s] = sendSources([], [near("100", "443.00", "ledger")], [near("2", "8.86", "private")], false);
  assert.deepEqual([s!.max, s!.part, s!.privateOnly], ["2", undefined, true]);
  assert.equal(s!.line, "NEAR · $8.86 in Private");
  assert.equal(privateRow("NEAR", "$8.86"), s!.line);
  for (const w of [s!.line, s!.part ?? "", s!.cant ?? ""]) assert.doesNotMatch(w, /can't|can go right now/, "never a standing can't line");
  // the From row and each list row show `line` (held = s.line ?? heldWords(s))
  assert.match(form, /const held = \(s: SendSource\) => s\.line \?\? heldWords\(s\);/);
  assert.match(form, /\{restStays\(source\) && !source\.privateOnly && /, "no standing \"rest stays\" line either");
  const [open] = sendSources([], [near("100", "443.00", "ledger")], [near("2", "8.86", "private")], true);
  assert.deepEqual([open!.privateOnly, open!.line, open!.part], [undefined, undefined, undefined], "control: route open, all of it can go: no Private figure, no line");
  assert.equal(SEND_PART(false, "$443.00"), "Up to $443.00 can go in one send.", "control: the route-open part line is unchanged");
});

test("the copy review's ruling: the keypad caps at Private's figure, in dollars to the cent (down) or in the coin; under or at it, untouched", () => {
  assert.deepEqual(privateCap("5", "2", 4.43, false), { amount: "2", typed: "8.86" }, "over: capped to Private's figure, the keypad shows its dollars");
  assert.deepEqual(privateCap("30", "25", 1, true), { amount: "25", typed: "25" }, "a dollar coin: its own figure");
  assert.deepEqual(privateCap("5", "2", null, false), { amount: "2", typed: "2" }, "no price: the coins");
  assert.equal(privateCap("2", "2", 4.43, false), null, "control: exactly the figure is not over");
  assert.equal(privateCap("1.5", "2", 4.43, false), null, "control: under it, untouched");
  // the form's keypad goes through type(): only a Send from Private is capped (a route-open Safe coin keeps finding 64)
  assert.match(form, /const cap = source\.privateOnly \? privateCap\(round\(coins, places, "down"\), source\.max, perCoin, stable\) : null;\n\s+if \(cap\) \{ setTyped\(cap\.typed\); setAmount\(cap\.amount\); setCapped\(true\); return; \}/);
});

test("the copy review's ruling: one line, only when the typed amount was over Private's figure; gone on the next key, Max or another coin (control: never shown before that, and the route-open over line is unchanged)", () => {
  assert.equal(privateOver("$8.86", "NEAR"), "Private holds $8.86 of NEAR. Send up to that, or pick another coin.");
  assert.match(form, /\{capped && source\.privateOnly\n\s*\? <p className="zf-small wl-send2__coins" role="status" data-testid="send-private-over">\{privateOver\(most, source\.symbol\)\}<\/p>\n/);
  assert.match(form, /const type = \(v: string\) => \{\n\s+setAmountNo\(null\);\n[^\n]*\n\s+setTyped\(clean\);\n\s+setCapped\(false\);/, "each key starts with no line");
  assert.match(form, /const setCoins = \(coins: string\) => \{\n\s+setExact\(null\);\n\s+setCapped\(false\);/, "Max and the slider: no line");
  assert.match(form, /setAmount\("0"\); setCapped\(false\); \}\}/, "another coin: no line");
  assert.match(form, /useState\(false\);\n/, "control: no line until capped");
  assert.equal(overLine("your Safe", "$443.00"), "You can send at most $443.00 from your Safe.", "control: the route-open over line, as before");
});
