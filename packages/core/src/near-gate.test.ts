// Audit pass 2, item 6a: NEAR_GATE was a mutable exported object (near-gate.ts), so any script holding the module could
// open NEAR coin trades. It is frozen now; `open` changes only in a Node process (the test runner, tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_GATE, gateSettable } from "./near-gate.ts";

test("audit pass 2: the NEAR gate is frozen, shut by default, and only a Node process may open it", () => {
  assert.equal(Object.isFrozen(NEAR_GATE), true);
  assert.equal(NEAR_GATE.open, false);
  assert.throws(() => Object.defineProperty(NEAR_GATE, "open", { value: true }));
  assert.throws(() => { (NEAR_GATE as Record<string, unknown>).other = 1; });
  // the app: a browser (window) or the iPhone's JavaScriptCore (no process) can't set it
  assert.equal(gateSettable({ window: {} , process: { versions: { node: "22" } } }), false);
  assert.equal(gateSettable({}), false);
  assert.equal(gateSettable({ process: { versions: {} } }), false);
  // control: a Node process (the test runner) can, and a non-true value shuts it
  assert.equal(gateSettable({ process: { versions: { node: "22.0.0" } } }), true);
  try {
    NEAR_GATE.open = true;
    assert.equal(NEAR_GATE.open, true);
    (NEAR_GATE as { open: unknown }).open = "yes";
    assert.equal(NEAR_GATE.open, false, "only true opens it");
  } finally { NEAR_GATE.open = false; }
});
