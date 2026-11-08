// Audit 16 re-grade of b19's g3-solana-move (8 Nov): the SOL row's figure read "223.76" with no unit while it was typed, under
// rows that say "$5,222.40". Every figure carries its currency: the typed field says "$223.76" too, and a "$" typed or kept
// is still read as dollars. Fails on main: the field showed typing.text bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextTyped, typingShown } from "./move-split.ts";

test("a typed row figure carries its unit; the $ never breaks the typing", () => {
  assert.equal(typingShown("223.76"), "$223.76");
  assert.equal(typingShown(""), "$");
  // the field's own value comes back with its "$": the digits are read, the unit kept off the typed text
  assert.equal(nextTyped("223.7", "$223.76"), "223.76");
  assert.equal(nextTyped("", "$"), "");
  assert.equal(nextTyped("22", "$22a"), "22", "control: a letter is still refused");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /value=\{typing\?\.place === x\.place \? typingShown\(typing\.text\) : usdShort\(v\)\}/);
  assert.doesNotMatch(sheet, /\? typing\.text : usdShort\(v\)/, "no bare figure");
});
