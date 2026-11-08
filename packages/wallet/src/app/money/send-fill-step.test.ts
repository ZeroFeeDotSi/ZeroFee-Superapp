import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fillStepUsd } from "@zerofee/core/private-route";
import { FILL_STEP_WORDS, fillStepLine } from "./send-cap.ts";

// the audit's S9 (7 Nov): a $5 Safe Send moves $10 out of the Safe (the fill's whole step) with about $5 left in Private, and the
// person first met "From your Safe · $10.00" on the Face ID sheet. The floor says it, once, before the tap.
const safe = { place: "your Safe", row: null, pocket: 0, per: 1 };

test("the audit's S9: a Safe Send that fills Private says the fill's step and what stays in Private, before the tap", () => {
  assert.equal(fillStepUsd(5), 10, "the core's step for $5");
  assert.equal(fillStepLine({ ...safe, coins: 5 }), "$10.00 leaves your Safe. About $5.00 stays in Private.");
  assert.equal(FILL_STEP_WORDS("$10.00", "$5.00"), "$10.00 leaves your Safe. About $5.00 stays in Private.");
  assert.equal(fillStepLine({ ...safe, coins: 120 }), "$150.00 leaves your Safe. About $30.00 stays in Private.", "a $50 step past $100");
  assert.equal(fillStepLine({ ...safe, coins: 2, per: 4.5 }), "$10.00 leaves your Safe. About $1.00 stays in Private.", "any coin, by its price ($9.00 of NEAR)");
  assert.equal(fillStepLine({ ...safe, coins: 5, pocket: 3 }), "$10.00 leaves your Safe. About $5.00 stays in Private.", "the whole Send goes through the fill, Private's share left");
});

test("the audit's S9 controls: Private pays it whole, a wallet's coin, a Private-only coin, no price, nothing typed, or a fill past the buffer: no line", () => {
  assert.equal(fillStepLine({ ...safe, coins: 5, pocket: 5 }), null, "Private holds it all: no fill");
  assert.equal(fillStepLine({ ...safe, place: "your SOL wallet", row: "sol" as never, coins: 5 }), null);
  assert.equal(fillStepLine({ ...safe, privateOnly: true, coins: 5 }), null);
  assert.equal(fillStepLine({ ...safe, per: null, coins: 5 }), null);
  assert.equal(fillStepLine({ ...safe, coins: 0 }), null);
  assert.equal(fillStepLine({ ...safe, coins: 5, pocket: 498 }), null, "Private's share + the step's extra over $500: the fill is the Send's own figure, nothing stays");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /\{fillStep && <p className="zf-small" data-testid="send-fill-step">\{fillStep\}<\/p>\}/, "on the floor, over the fee block");
  assert.ok(form.indexOf('data-testid="send-fill-step"') < form.indexOf('data-testid="send-go"'), "before the tap");
});
