// The NEAR sheet's switched line (rule 9a, review, 5 Nov): on with doors.ts onSwitch's line, off with its null, said
// once while it lasts; words that pass the voice guard (never "relay"); wired in route.ts and shown on NEAR's sheet only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SWITCHED_LINE, isSwitched, saySwitched } from "./switched.ts";
import { NEAR_RELAY_SWITCHED } from "./problems.ts";
import { grade } from "../../../../tools/copy/voice.ts";

test("on when the hook says it switched, off when a paid door answers (control: a repeat changes nothing)", () => {
  assert.equal(isSwitched(), false);
  saySwitched(NEAR_RELAY_SWITCHED); assert.equal(isSwitched(), true);
  saySwitched(NEAR_RELAY_SWITCHED); assert.equal(isSwitched(), true, "said once while it lasts");
  saySwitched(null); assert.equal(isSwitched(), false, "cleared when the server answers");
});

test("the words: ZeroFee's server by name, what ZeroFee did, that trades still work; graded A; one copy, the hook's own (control: the vague may is gone)", () => {
  assert.equal(SWITCHED_LINE, "ZeroFee's server isn't answering. ZeroFee switched to NEAR's public servers. Trades still work; they can take longer.");
  const g = grade("packages/trade/src/near/switched.ts", SWITCHED_LINE);
  assert.equal(g.grade, "A", g.problems.join("; "));
  assert.ok(!/relay/i.test(SWITCHED_LINE));
  assert.equal(NEAR_RELAY_SWITCHED, SWITCHED_LINE, "the hook says the sheet's words, exactly");
  assert.match(NEAR_RELAY_SWITCHED, /can take longer/);
  assert.doesNotMatch(NEAR_RELAY_SWITCHED, /\bmay\b/, "control: the vague may the voice guard grades down");
  assert.notEqual(grade("packages/trade/src/near/switched.ts", SWITCHED_LINE.replace("can take", "may take")).grade, "A", "control: the old may line isn't A");
});

test("wired: route.ts hands the hook saySwitched; Trenches' sheet shows it under the amount's line, for a NEAR coin only, zf-small", () => {
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(route, /nearTradeNodes\(relay, undefined, saySwitched\)/);
  const sheet = readFileSync(new URL("../app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const switched = useSwitchedLine\(\);/);
  assert.match(sheet, /\{switched && coin\.chain === "near" && <p className="zf-small tp-switched" role="status" data-testid="near-switched">\{switched\}<\/p>\}\n\s+\{filledBy/);
});
