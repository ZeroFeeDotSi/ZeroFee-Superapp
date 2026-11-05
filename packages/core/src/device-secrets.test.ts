import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps, routeBridge } from "./bridge.ts";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { deviceSecrets } from "./device-secrets.ts";
import { MemoryVault } from "./vault.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(r.problem.whatHappened);
  return r.ok;
};
const core: Bridge = { call: async () => ({ problem: { code: "core", whatHappened: "", money: { state: "not-involved" }, next: { kind: "nothing", label: "" } } }), on: () => () => {} };

test("each app reaches only its own secrets, whatever it claims to be", async () => {
  const host = routeBridge(core, { device: deviceSecrets(new MemoryVault()) });
  const agent = forApps(host, "agent");
  const wallet = forApps(host, "wallet");
  ok(await agent.call("device.secret.set", { key: "claude-api-key", value: "sk-test" }));
  assert.deepEqual(ok(await agent.call("device.secret.get", { key: "claude-api-key" })), { value: "sk-test" });
  assert.deepEqual(ok(await wallet.call("device.secret.get", { key: "claude-api-key", app: "agent" })), { value: null });
  ok(await agent.call("device.secret.set", { key: "claude-api-key", value: null }));
  assert.deepEqual(ok(await agent.call("device.secret.get", { key: "claude-api-key" })), { value: null });
});

test("names and sizes are checked; a call with no app is refused", async () => {
  const secrets = deviceSecrets(new MemoryVault());
  const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
  assert.equal(code(await secrets.call("device.secret.get", { key: "x" })), "security.secret.refused");
  assert.equal(code(await secrets.call("device.secret.set", { app: "agent", key: "../wallet:x", value: "v" })), "security.secret.refused");
  assert.equal(code(await secrets.call("device.secret.set", { app: "agent", key: "big", value: "v".repeat(4097) })), "security.secret.refused");
  assert.equal(code(await secrets.call("device.secret.set", { app: "agent", key: "ok", value: "v" })), "ok");
});

test("a service call carries the real calling app, whatever the app claims", async () => {
  let seen: Record<string, unknown> | undefined;
  const ledger: Bridge = { call: async (_m, p) => ((seen = p), { ok: {} as any }), on: () => () => {} };
  const host = routeBridge(core, { ledger });
  await forApps(host, "trade").call("ledger.transfer", { to: "bob.near", caller: "wallet" });
  assert.equal(seen?.caller, "trade");
  assert.throws(() => routeBridge(core, { card: ledger }), /trusted core/);
});
