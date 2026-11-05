// Release 9 → 10 (D57, the product go-ahead on 4 Nov): a release-9 account is offered release 10, so AgentZero can hold pocket
// money, only once two nodes show release 10 published under its pinned hash with its pinned sha256. Release 9 lists a
// release on the account's own list first (AllowRelease): the phone alone lists it no sooner than the backup words'
// fallback wait, then the update itself waits its own. Nothing else about the account changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToBase64 } from "@fastnear/utils";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { ACCOUNT_POLICY, RELEASE_10, hasAgent, knownReleaseBySha, ownAccountCall } from "./known-contracts.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const DAY = 86_400;
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const b64 = (hex: string) => bytesToBase64(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
type Rules = { release: number; current: number; update?: { waitSeconds: number; needsSecondDevice: boolean; listFirst?: true; thenWaitSeconds?: number; waiting?: { id: string; readyAtIso: string } } };

/** A new account (release 9) with a week's recovery delay: its floor is 8 days, its words-only fallback 21. */
async function release9() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", (await import("./device-key.ts")).SoftwareKey.generate().publicKey, 0n);
  const core: Bridge & { close(): void } = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 604_800 });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  return { chain, core, accountId, a: chain.accounts.get(accountId)! };
}

test("not published, or published as other code: nothing is offered and nothing can be asked", async () => {
  const { chain, core } = await release9();
  try {
    const none = ok(await core.call<Rules>("account.rules"));
    assert.deepEqual([none.release, none.current, none.update], [9, 10, undefined]);
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
    chain.publishGlobal(RELEASE_10.codeHashBase58, "00".repeat(32));
    assert.equal(ok(await core.call<Rules>("account.rules")).update, undefined, "a copy whose sha256 isn't the pin is never offered");
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
  } finally {
    core.close();
  }
});

test("published: the listing first (the words' fallback wait), then the update (its own wait); the account runs release 10", async () => {
  const { chain, core, a } = await release9();
  const realNow = Date.now;
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const before = { bands: JSON.stringify(a.rules!.bands), recoveryKey: a.rules!.recoveryKey, delay: a.policy!.delayNs };
    const offer = ok(await core.call<Rules>("account.rules"));
    assert.equal(offer.current, 10);
    assert.equal(offer.update?.listFirst, true);
    assert.equal(offer.update?.waitSeconds, 21 * DAY, "the words-only fallback: three times the week's delay");
    assert.equal(offer.update?.thenWaitSeconds, 8 * DAY, "then the update's own wait: the floor");

    // Asked (one Face ID, product decision, 5 Nov order): the listing and the switch wait together, named as release 10's, never
    // as unknown code; asked twice is refused.
    const listed = ok(await core.call<{ status: string }>("account.rules.update"));
    assert.equal(listed.status, "waiting");
    assert.deepEqual(a.rules!.waiting.map((w) => Object.keys(w.change)[0]), ["AllowRelease", "Upgrade"]);
    assert.equal((a.rules!.waiting[0]!.change as { AllowRelease: { code_hash: string } }).AllowRelease.code_hash, b64(RELEASE_10.sha256Hex));
    const waiting = ok(await core.call<Rules>("account.rules"));
    const base = Date.now();
    assert.ok(waiting.update?.waiting, "said as waiting");
    assert.ok(Math.abs(Date.parse(waiting.update!.waiting!.readyAtIso) - (base + 21 * DAY * 1000)) < 60_000, "ready after the fallback, not the floor");
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
    const held = ok(await core.call<{ id: string; title: string; ready: boolean; readyAtIso: string }[]>("account.waiting"));
    assert.equal(held[0]!.title, "Let your account's rules update");
    assert.ok(Math.abs(Date.parse(held[0]!.readyAtIso) - (base + 21 * DAY * 1000)) < 60_000, "the Waiting screen says the same time");

    // Past the floor but before the fallback: never ready, and the contract refuses it.
    Date.now = () => base + 9 * DAY * 1000;
    assert.equal(ok(await core.call<{ ready: boolean }[]>("account.waiting"))[0]!.ready, false);
    assert.notEqual(code(await core.call("account.waiting.run", { id: held[0]!.id })), "ok");

    // The switch waits behind its listing: said ready no sooner (its own floor, 8 days, is sooner than the listing's 21).
    assert.ok(Math.abs(Date.parse(held[1]!.readyAtIso) - (base + 21 * DAY * 1000)) < 60_000, "the switch: the listing's time");
    // After the fallback: listed, then the switch (its floor long over) runs.
    Date.now = () => base + 21 * DAY * 1000 + 1000;
    assert.equal(code(await core.call("account.waiting.run", { id: held[0]!.id })), "ok");
    assert.deepEqual(a.rules!.waiting.map((w) => Object.keys(w.change)[0]), ["Upgrade"]);
    const up = ok(await core.call<{ id: string }[]>("account.waiting"));
    assert.equal(code(await core.call("account.waiting.run", { id: up[0]!.id })), "ok");

    assert.equal(a.codeHash, RELEASE_10.codeHashBase58, "the account runs release 10 by its published hash");
    assert.ok(hasAgent(a.codeHash));
    const after = ok(await core.call<Rules>("account.rules"));
    assert.deepEqual([after.release, after.update], [10, undefined], "nothing more to offer");
    // Its state came along: the same bands, backup words and delay; the phone's key has release 10's methods.
    assert.deepEqual({ bands: JSON.stringify(a.rules!.bands), recoveryKey: a.rules!.recoveryKey, delay: a.policy!.delayNs }, before);
    const phone = [...a.keys.values()].find((k) => k.permission.kind === "function-call" && k.permission.methods.includes("execute"));
    assert.deepEqual(phone?.permission.kind === "function-call" ? phone.permission.methods : null, [...RELEASE_10.deviceMethods]);
  } finally {
    Date.now = realNow;
    core.close();
  }
});

test("the sheet names release 10 by its pinned sha256 only; any other code stays unknown", () => {
  assert.equal(knownReleaseBySha(RELEASE_10.sha256Hex), 10);
  assert.equal(knownReleaseBySha(ACCOUNT_POLICY.sha256Hex), 9);
  assert.equal(knownReleaseBySha(RELEASE_10.shortWaits.sha256Hex), null, "the short-waits build is never offered");
  const ten = ownAccountCall("upgrade", { code_hash: b64(RELEASE_10.sha256Hex) })!;
  assert.equal(ten.title, "Update your account's rules");
  assert.deepEqual(ten.lines, ["AgentZero can have its own wallet, which you fund.", "Your other rules stay the same."]);
  assert.equal(ten.warnings, undefined);
  const other = ownAccountCall("upgrade", { code_hash: b64("ab".repeat(32)) })!;
  assert.equal(other.title, "Unknown code. Cancel this");
});
