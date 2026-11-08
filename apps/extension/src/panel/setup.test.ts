import { test } from "node:test";
import assert from "node:assert/strict";
import { stepFor } from "./setup.ts";

test("no wallet yet: Welcome, or the wallet step once started (closing the panel is 'later')", () => {
  assert.equal(stepFor("none", undefined), "welcome");
  assert.equal(stepFor("none", "welcome"), "welcome");
  assert.equal(stepFor("none", "wallet"), "wallet");
  assert.equal(stepFor("none", "done"), "welcome");
});

test("a wallet made in the journey opens on the stored step after it, locked or not", () => {
  for (const stage of ["locked", "unlocked"] as const) {
    assert.equal(stepFor(stage, "money"), "money");
    assert.equal(stepFor(stage, "link"), "set", "audit 15 FE1: no phone step while the phone's tab isn't shown");
    assert.equal(stepFor(stage, "set"), "set");
    assert.equal(stepFor(stage, "wallet"), "money");   // closed before the step was stored
  }
});

test("a finished journey, or a wallet from before it, shows the wallet itself", () => {
  assert.equal(stepFor("unlocked", "done"), "done");
  assert.equal(stepFor("unlocked", undefined), "done");
  assert.equal(stepFor("locked", undefined), "done");
});
