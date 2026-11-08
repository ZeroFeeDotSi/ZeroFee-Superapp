// Audit 13's D11 (8 Nov): Add to Private named NEAR Intents ("NEAR Intents sees every payment.") and never NEAR
// Confidential before the tap. Every money move names the protocol that moves it (the hard rule, 4 Nov).
// Fails on main: no PRIVATE_THROUGH, the sheet drew PRIVATE_SEEN under PRIVATE_IS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVATE_THROUGH } from "../format.ts";

const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");

test("D11: Add to Private says NEAR Confidential moves it, once, before the tap", () => {
  assert.equal(PRIVATE_THROUGH, "It goes in through NEAR Confidential.");
  const add = src.slice(src.indexOf('data-testid="private-is"'), src.indexOf("</div>", src.indexOf('data-testid="private-is"')));
  assert.match(add, /<p className="zf-small" data-testid="private-through">\{PRIVATE_THROUGH\}<\/p>/);
  assert.doesNotMatch(add, /PRIVATE_SEEN/, "one idea once: the public part is on its Check");
});
