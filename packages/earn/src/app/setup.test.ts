import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { FRESH, later, loadSetup, saveSetup, showWelcome, staked } from "./setup.ts";

test("setup: Welcome until Later or a stake, and never with NEAR already earning", () => {
  assert.equal(showWelcome(FRESH, false), true, "first open");
  assert.equal(showWelcome(FRESH, true), false, "skipped: something is earning through Earn");
  assert.equal(showWelcome(later(FRESH), false), false, "Later ends it");
  assert.equal(showWelcome(staked(FRESH), false), false, "a stake, done or held, ends it");
});

test("setup: kept on the device as setup.v1; missing or unreadable is a fresh start", async () => {
  const bridge = forApps(createMockBridge({ latencyMs: 0 }), "earn");
  assert.deepEqual(await loadSetup(bridge), FRESH);
  await saveSetup(bridge, later(FRESH));
  assert.deepEqual(await loadSetup(bridge), { v: 1, later: true });
  await bridge.call("device.store.set", { key: "setup.v1", value: "{not json" });
  assert.deepEqual(await loadSetup(bridge), FRESH);
  await bridge.call("device.store.set", { key: "setup.v1", value: JSON.stringify({ v: 1, staked: "yes", extra: 1 }) });
  assert.deepEqual(await loadSetup(bridge), FRESH, "only real flags count");
});
