// Review of ecd41879 (3 Nov): AgentZero refused every swap ("The swap service isn't answering…") after one slow or failed
// call this phone saw, while 1Click answered in half a second. 1Click is "down" only on fresh, repeated evidence: the
// relay's own minute check says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oneClickDown, type ServiceStatus } from "./services.ts";

test("1Click is down only when the relay's own check says down; one call this phone saw, slow or busy is never down (controls)", () => {
  const row = (r: Partial<ServiceStatus>): ServiceStatus => ({ service: "oneclick", state: "down", ...r });
  assert.equal(oneClickDown([row({ seen: "relay" })]), true, "the relay's check: down");
  assert.equal(oneClickDown([row({ seen: "both" })]), true, "the relay and this phone: down");
  // controls
  assert.equal(oneClickDown([row({ seen: "device" })]), false, "one call this phone saw fail: not down");
  assert.equal(oneClickDown([row({ state: "slow", seen: "relay" })]), false, "slow: not down");
  assert.equal(oneClickDown([row({ state: "busy", seen: "both" })]), false, "busy: not down");
  assert.equal(oneClickDown([row({ service: "bridge", seen: "relay" })]), false, "another service down: not 1Click");
  assert.equal(oneClickDown([]), false, "all up (no rows)");
  assert.equal(oneClickDown(null), false, "unread: not down");
});
