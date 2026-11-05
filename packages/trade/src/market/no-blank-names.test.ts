// sd-security (h) (QA 4 Nov): a Trade coin showed as "██████". A name with no letter or digit is no name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLabel } from "./map.ts";

test("a label with no letter or digit is none (control: real names, other scripts and emoji-with-letters stay)", () => {
  assert.equal(cleanLabel("██████"), "");
  assert.equal(cleanLabel(" ■ ▲ "), "");
  assert.equal(cleanLabel("DOPE"), "DOPE", "control");
  assert.equal(cleanLabel("狗狗币"), "狗狗币", "control: letters in any script");
  assert.equal(cleanLabel("🐸PEPE"), "🐸PEPE", "control");
  assert.equal(cleanLabel("$1"), "$1", "control: a digit");
  assert.equal(cleanLabel("🐸🐸"), "🐸🐸", "control: emoji alone is a name");
});
