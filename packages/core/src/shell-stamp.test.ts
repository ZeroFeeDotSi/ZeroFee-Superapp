// Audit pass 2, item 2: a call that names no app is never ZeroFee's own screens in a page or the phone's core. The
// shell's own bridge stamps SHELL_APP (asShell); forApps stamps every app's id on every core call and never lets an app
// send the shell's; the core refuses a call with no app, or app "", whatever the method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHELL_APP, asShell, forApps, type Bridge, type BridgeResult } from "./bridge.ts";
import { DemoCore, unstampedMayBeShell } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { createSpendingService, type EngineSnapshot, type SpendingEngine } from "./spending.ts";

// The account contract's short-waits build: the recovery-only contract is never installed any more (audit, core integrity 4).
const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const REFUSED = "security.request.not-allowed";

/** A ready account on a core that, like the page's and the phone's, takes no unstamped call as the shell's. */
async function pageCore() {
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, unstampedIsShell: false });
  const shell = asShell(core);
  // the approval sheet is the shell's: its yes is a stamped call too
  shell.on<{ id: string }>("approval.needed", ({ id }) => void shell.call("approval.answer", { id, approve: true }));
  ok(await shell.call("account.create"));
  const { words } = ok(await shell.call<{ words: string[] }>("recovery.words"));
  ok(await shell.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  return { core, shell };
}

test("a page's or the phone's core: no app, or app \"\", is refused for every method; the shell's stamped calls work", async () => {
  const { core, shell } = await pageCore();
  try {
    const wallet = ok(await shell.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol" }));
    for (const unstamped of [{}, { app: "" }, { app: null }, { app: 0 }]) {
      const say = JSON.stringify(unstamped);
      assert.equal(code(await core.call("subwallet.export", { id: wallet.id, ...unstamped })), REFUSED, `subwallet.export ${say}`);
      assert.equal(code(await core.call("recovery.cancel", unstamped)), REFUSED, `recovery.cancel ${say}`);
      assert.equal(code(await core.call("subwallet.private.home", { tokenId: "nep141:usdc", amount: "all", key: "k1", ...unstamped })), REFUSED, `subwallet.private.home ${say}`);
      // and everything else: an unstamped call is no one's
      for (const m of ["account.state", "subwallet.list", "subwallet.near.balance", "subwallet.float.nearOut", "subwallet.float.addStatus", "subwallet.received", "subwallet.float.quoteAdd", "approval.answer", "secondDevice.state"]) {
        assert.equal(code(await core.call(m, unstamped)), REFUSED, `${m} ${say}`);
      }
    }
    // the control: the shell's own (stamped) calls reach each method
    assert.ok("secretKey" in ok(await shell.call<{ secretKey: string }>("subwallet.export", { id: wallet.id })), "the shell's export: after its sheet");
    assert.notEqual(code(await shell.call("recovery.cancel")), REFUSED, "the shell's recovery.cancel reaches the cancel");
    assert.notEqual(code(await shell.call("subwallet.private.home", { tokenId: "nep141:usdc", amount: "all", key: "k1" })), REFUSED, "the shell's private.home reaches the pocket");
    assert.equal(ok(await shell.call<{ stage: string }>("account.state")).stage, "ready");
    assert.equal(ok(await core.call<{ stage: string }>("account.state", { app: SHELL_APP })).stage, "ready", "the stamp itself is SHELL_APP");
    // an app is still itself: Wallet may not show a chain wallet's key, nor cancel a recovery
    assert.equal(code(await forApps(core, "wallet").call("subwallet.export", { id: wallet.id })), REFUSED);
  } finally {
    core.close();
  }
});

test("forApps: an app can't send the shell's id, nor no id; every core call it makes carries its own", async () => {
  const seen: { method: string; params: Record<string, unknown> | undefined }[] = [];
  const fake: Bridge = { call: async (method, params) => (seen.push({ method, params }), { ok: null as never }), on: () => () => {} };
  const pay = forApps(fake, "pay");
  await pay.call("subwallet.export", { id: "w", app: SHELL_APP });
  await pay.call("account.state", { app: SHELL_APP });
  await pay.call("account.state");
  await pay.call("tx.request", { request: { to: "x", from: "security" }, app: "" });
  for (const s of seen) assert.equal(s.params?.app, "pay", `${s.method}: ${JSON.stringify(s.params)}`);
  assert.equal((seen[3]!.params!.request as { from: string }).from, "pay");
  // asShell in front of an app's bridge never relabels it: an app's call already names the app
  seen.length = 0;
  await asShell(fake).call("account.state", { app: "pay" });
  assert.equal(seen[0]!.params!.app, "pay");
  await asShell(fake).call("account.state");
  assert.equal(seen[1]!.params!.app, SHELL_APP);
  // no app's bridge can be made as the shell, or as no one
  assert.throws(() => forApps(fake, SHELL_APP as never));
  assert.throws(() => forApps(fake, "" as never));
});

test("only a Node process (the tests, the test tools) may take an unstamped call as the shell's; never a page or the phone's core", () => {
  assert.equal(unstampedMayBeShell({ process: { versions: { node: "24.0.0" } } }), true);
  assert.equal(unstampedMayBeShell({ process: { versions: { node: "24.0.0" } }, window: {} }), false, "a page (even one that has a process shim)");
  assert.equal(unstampedMayBeShell({}), false, "the phone's JavaScriptCore");
  assert.equal(unstampedMayBeShell({ process: { versions: {} } }), false);
  // and both production cores say it themselves
  const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  for (const p of ["apps/web/src/core.ts", "apps/ios/core/entry.ts"]) assert.match(read(p), /unstampedIsShell: false,/, p);
  assert.match(read("apps/web/src/core.ts"), /const core: Bridge = asShell\(/, "the shell's bridge stamps its own calls");
});

test("Spending: a caller of \"\" is no one's, never ZeroFee's own screens", async () => {
  const snap: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] };
  const engine = { snapshot: () => snap, subscribe: () => () => {}, refresh: async () => undefined, setCap: () => undefined } as unknown as SpendingEngine;
  const asked: string[] = [];
  const store = new Map<string, string>();
  const answers: Record<string, unknown> = { "subwallet.list": [{ id: "w0", kind: "trade", chain: "sol" }], "subwallet.export": { shown: true, secretKey: "k" } };
  const svc = createSpendingService({
    engine: () => engine,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      asked.push(method);
      if (method === "device.store.get") return { value: store.get(String(params.key)) ?? null } as T;
      if (method === "device.store.set") { store.set(String(params.key), String(params.value)); return { ok: true } as T; }
      if (method in answers) return answers[method] as T;
      throw new Error(`no answer for ${method}`);
    },
  });
  assert.equal(code(await svc.call("spending.exportKey", { id: "w0", caller: "" })), REFUSED);
  assert.equal(asked.filter((m) => m === "subwallet.export").length, 0, "the core was never asked");
  assert.deepEqual(await svc.call("spending.exportKey", { id: "w0" }), { ok: { shown: true, secretKey: "k" } }, "the shell (no caller) still may");
});
