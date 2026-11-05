// Being someone's guardian (guardian.ts): only the shell may ask; requests come flattened with their account; the
// guardian core's sheets reach the shell's sheet and their answers go back to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createGuardian } from "./guardian.ts";

function fakeCore() {
  const asked: [string, Record<string, unknown>][] = [];
  const handlers: ((p: { id: string }) => void)[] = [];
  const core: Bridge & { raise(id: string): void } = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      asked.push([method, params]);
      if (method === "secondDevice.state") return { ok: { code: "ZFL1:X", fingerprint: "ABCD", accounts: ["kim.near"] } as T };
      if (method === "secondDevice.requests") return { ok: [{ accountId: "kim.near", requests: [{ id: "3", title: "Send 900 NEAR to bob.near" }] }] as T };
      return { ok: { status: "done" } as T };
    },
    on: <T>(_e: string, h: (p: T) => void) => (handlers.push(h as (p: { id: string }) => void), () => {}),
    raise: (id) => handlers.forEach((h) => h({ id })),
  };
  return { core, asked };
}

test("only the shell may act as a guardian, and the requests come with the account they're on", async () => {
  const { core, asked } = fakeCore();
  let made = 0;
  const g = createGuardian(() => (made++, core));
  assert.equal(made, 0, "no key is made until it's asked for");
  const viaApp = await g.service.call("guardian.code", { caller: "trade" });
  assert.ok("problem" in viaApp && viaApp.problem.code === "security.method.unknown");
  const viaApp2 = await g.service.call("guardian.requests", { app: "wallet" });
  assert.ok("problem" in viaApp2);
  assert.deepEqual(await g.service.call("guardian.code"), { ok: { code: "ZFL1:X", fingerprint: "ABCD", accounts: ["kim.near"] } });
  assert.deepEqual(await g.service.call("guardian.requests"), { ok: [{ id: "3", title: "Send 900 NEAR to bob.near", accountId: "kim.near" }] });
  await g.service.call("guardian.answer", { accountId: "kim.near", id: "3", approve: false, extra: "x" });
  assert.deepEqual(asked.at(-1), ["secondDevice.answer", { accountId: "kim.near", id: "3", approve: false }]);
  assert.equal(made, 1);
});

test("its sheets reach the shell's sheet, and the answer goes back to it, not to the shell's core", async () => {
  const { core, asked } = fakeCore();
  const g = createGuardian(() => core);
  const shellAsked: string[] = [];
  const shell: Bridge = { call: async <T,>(m: string) => (shellAsked.push(m), { ok: null as T }), on: () => () => {} };
  const bridge = g.withApprovals(shell);
  const seen: string[] = [];
  bridge.on<{ id: string }>("approval.needed", (s) => seen.push(s.id));
  await g.service.call("guardian.code");
  core.raise("sheet-1");
  assert.deepEqual(seen, ["sheet-1"]);
  await bridge.call("approval.answer", { id: "sheet-1", approve: true });
  assert.deepEqual(asked.at(-1), ["approval.answer", { id: "sheet-1", approve: true }]);
  await bridge.call("approval.answer", { id: "other", approve: true });
  assert.deepEqual(shellAsked, ["approval.answer"], "anything else is the shell's own");
});
