// An account still on the account contract's release 4 (mainnet, 2 Nov: the test account, made before release 5,
// code hash 3NFQ7Dr…, deployed as its own copy). Release 4 has no frozen_until, recovery_status, second_device_ages,
// second_devices_of_age or allowed_releases (NEAR answers MethodNotFound, which the core reads as null), and its phone key
// holds release 4's method list. Every read Home, Security, Protection, Send, Top up and Activity make answers on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { ACCOUNT_POLICY, policyVersion } from "./known-contracts.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
export const V4 = "3NFQ7DrAoPLJ8iwfMvwz2koeFLkNJ65nHS4DxA61y5Kv";
const NEAR = "000000000000000000000000";
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
function sheet(core: Bridge) {
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
}

/** A v4 account: made as today's, then its code and its phone key set back to release 4's (what NEAR shows for it). */
export async function v4Account() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", (await import("./device-key.ts")).SoftwareKey.generate().publicKey, 0n);
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 604_800 });
  sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const a = chain.accounts.get(accountId)!;
  a.codeHash = V4;
  // The test account's bands (read on mainnet, 2 Nov): Face ID up to 5 NEAR, more waits 2 minutes.
  a.rules!.bands = [{ up_to: [["near", `5${NEAR}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }] as never;
  delete (a as { global?: string }).global;
  // Release 4's views that later releases added: NEAR's MethodNotFound, which the core's chain reads as null.
  for (const m of ["frozen_until", "recovery_status", "second_device_ages", "second_devices_of_age", "allowed_releases", "fallback_seconds"]) chain.views.set(`${accountId} ${m}`, () => null);
  return { chain, core, accountId, a };
}

test("release 4 is known by its hash", () => {
  assert.equal(policyVersion(V4), 4);
  assert.ok(ACCOUNT_POLICY.olderCodeHashes.includes(V4));
});

test("a release-4 account: Home, Security, Protection and Activity read without a Problem", async () => {
  const { core } = await v4Account();
  try {
    for (const [method, params] of [
      ["account.state", {}],
      ["account.protection.get", {}],
      ["account.secondDevices", {}],
      ["account.waiting", {}],
      ["account.activity", { limit: 20 }],
    ] as const) {
      const r = await core.call(method, params);
      if (process.env.SHOW) console.log(method, JSON.stringify(r).slice(0, 2500));
      assert.equal(code(r), "ok", `${method}: ${"problem" in r ? r.problem.whatHappened : ""}`);
    }
  } finally {
    core.close();
  }
});

test("a release-4 account: a payment under Face ID goes", async () => {
  const { core } = await v4Account();
  try {
    const r = await core.call("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `1${NEAR}` }], why: "", from: "wallet" } });
    assert.equal(code(r), "ok", "problem" in r ? r.problem.whatHappened : "");
  } finally {
    core.close();
  }
});

test("a release-4 account: a payment over Face ID waits its 2 minutes and then goes (the held reads on release 4)", async () => {
  const { core } = await v4Account();
  const realNow = Date.now;
  try {
    const r = ok(await core.call<{ status: string; id?: string }>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `6${NEAR}` }], why: "", from: "wallet" } }));
    assert.equal(r.status, "waiting");
    const held = ok(await core.call<{ id: string }[]>("account.waiting"));
    assert.equal(held.length, 1);
    const base = Date.now();
    Date.now = () => base + 121_000;
    assert.equal(code(await core.call("account.waiting.run", { id: held[0]!.id })), "ok");
  } finally {
    Date.now = realNow;
    core.close();
  }
});

test("a release-4 account is offered ZeroFee's current rules, with the wait its own rules set; the update runs after it", async () => {
  const { chain, core, a } = await v4Account();
  const realNow = Date.now;
  try {
    // Not published under its hash: nothing is offered (never an update to code two nodes don't show).
    const before = ok(await core.call<{ release: number; current: number; update?: unknown }>("account.rules"));
    assert.deepEqual([before.release, before.current, before.update], [4, 9, undefined]);
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
    chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
    const info = ok(await core.call<{ release: number; update?: { waitSeconds: number; needsSecondDevice: boolean; gets?: unknown } }>("account.rules"));
    assert.equal(info.update?.waitSeconds, 120, "release 4 places its upgrade at the strictest band: this account's 2 minutes");
    assert.equal(info.update?.needsSecondDevice, false);
    const placed = ok(await core.call<{ status: string; id?: string }>("account.rules.update"));
    assert.equal(placed.status, "waiting");
    // Asked for: said as waiting, never offered (or placed) twice.
    const waiting = ok(await core.call<{ update?: { waiting?: { id: string } } }>("account.rules"));
    assert.ok(waiting.update?.waiting?.id, "the update is said as waiting");
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
    const base = Date.now();
    Date.now = () => base + 121_000;
    const held = ok(await core.call<{ id: string }[]>("account.waiting"));
    assert.equal(code(await core.call("account.waiting.run", { id: held[0]!.id })), "ok");
    assert.equal(a.global, ACCOUNT_POLICY.codeHashBase58, "the account now uses the current release by its hash");
    const after = ok(await core.call<{ release: number; update?: unknown }>("account.rules"));
    assert.deepEqual([after.release, after.update], [9, undefined], "nothing more to offer");
  } finally {
    Date.now = realNow;
    core.close();
  }
});

test("today's release is offered nothing", async () => {
  const chain = new FakeChain();
  chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 604_800 });
  sheet(core);
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    const info = ok(await core.call<{ release: number; update?: unknown }>("account.rules"));
    assert.deepEqual([info.release, info.update], [9, undefined]);
  } finally {
    core.close();
  }
});

test("an unexpected throw says where, in a small details line, and never a key", async () => {
  const { unexpectedDetails } = await import("./security-problems.ts");
  const line = unexpectedDetails("account.state", new TypeError(`Cannot read properties of null (reading 'x') ed25519:${"A".repeat(60)}`));
  assert.match(line, /^Details for ZeroFee: security\.unexpected · account\.state · TypeError: Cannot read properties of null/);
  assert.doesNotMatch(line, /A{24}/);
});
