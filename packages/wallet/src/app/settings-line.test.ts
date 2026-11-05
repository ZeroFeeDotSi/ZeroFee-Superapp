import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsLine } from "./settings-line.ts";

test("sd-security (e): the Sim's Settings row promises no lock or passwords; each kind says its own (control: the phone keeps them)", () => {
  const sim = settingsLine({ phone: false, webWallet: false, sim: true });
  assert.doesNotMatch(sim, /lock|password/i);
  assert.equal(sim, "Colors, start over");
  assert.doesNotMatch(settingsLine({ phone: false, webWallet: true, sim: false }), /currency|password/i);
  assert.equal(settingsLine({ phone: true, webWallet: false, sim: false }), "Colors, passwords, Face ID, lock", "control");
});
