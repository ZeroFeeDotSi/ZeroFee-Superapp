// Audit IOS-4 (core and iOS host, 28 Oct 2026; FIXED): on the phone the page could read the vault items of the guardian's
// and the Kids parent's second devices, their private seeds among them. Now those second devices run inside the core
// (demo-core.ts `secondDevice.*`, the shell only, one per space): their keys live in the core's vault under
// "second-device:<space>:", sealed to the chip (Seal.swift), a key the page kept before moves in on first read, their
// sheets are the core's own, and the page gets no vault at all (IsolatedCore.swift pageMayUse).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { SoftwareKey } from "./device-key.ts";
import { SecondDeviceCore } from "./second-device.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const NEAR = "000000000000000000000000";
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const realNow = Date.now;
const advance = (seconds: number) => {
  const base = Date.now();
  Date.now = () => base + seconds * 1000;
};

test("IOS-4: the guardian's key lives in the core's own vault space; a key the page kept moves in once, the same key", async () => {
  const vault = new MemoryVault();
  const seed = SoftwareKey.generate().exportSeed();
  await vault.put("zerofee-guardian:second-device-seed", seed);
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  const moved = ok(await core.call<{ fingerprint: string }>("secondDevice.state", { space: "guardian" }));
  const before = new MemoryVault();
  await before.put("second-device-seed", seed);
  const same = ok(await new SecondDeviceCore({ chain: new FakeChain(), vault: before }).call<{ fingerprint: string }>("secondDevice.state"));
  assert.equal(moved.fingerprint, same.fingerprint, "the pairing carries on with the same key");
  assert.equal(await vault.get("zerofee-guardian:second-device-seed"), null, "gone from the name the page could read");
  assert.deepEqual(await vault.get("second-device:guardian:second-device-seed"), seed);
});

test("IOS-4: only the shell asks, and only for a guardian", async () => {
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm });
  assert.equal(code(await core.call("secondDevice.state", { space: "guardian", caller: "trade" })), "security.method.unknown");
  assert.equal(code(await core.call("secondDevice.state", { space: "guardian", app: "wallet" })), "security.method.unknown");
  for (const space of [undefined, "", "zerofee-guardian", "kid-alice", "kid-", "phone"]) {
    assert.equal(code(await core.call("secondDevice.state", { space })), "security.request.invalid", String(space));
  }
});

test("IOS-4: a guardian inside the core answers on the core's own sheet", async () => {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const protection = [{ up_to: [["near", `5${NEAR}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  const phone = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection, watchIntervalMs: 20, indexRetryMs: 1 });
  phone.on<{ id: string }>("approval.needed", ({ id }) => void phone.call("approval.answer", { id, approve: true }));
  // The guardian's phone: its core, with no account of its own; its sheet is the core's approval.needed.
  const theirs = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm });
  const shown: PlainWords[] = [];
  theirs.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => (shown.push(words), void theirs.call("approval.answer", { id, approve: true })));
  try {
    const { accountId } = ok(await phone.call<{ accountId: string }>("account.create"));
    const { words } = ok(await phone.call<{ words: string[] }>("recovery.words"));
    ok(await phone.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    const pairing = ok(await theirs.call<{ code: string }>("secondDevice.state", { space: "guardian" })).code;
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: pairing, kind: "guardian" }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const limit = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.setLimit", { usd: 20 }));
    advance(250);
    ok(await phone.call("account.waiting.run", { id: limit.id }));
    const pay = ok(await phone.call<TxOutcome & { id: string; needsSecondDevice: boolean }>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `6${NEAR}` }], why: "", from: "wallet" } }));
    assert.equal(pay.needsSecondDevice, true);
    const yes = ok(await theirs.call<TxOutcome>("secondDevice.answer", { space: "guardian", accountId, id: pay.id, approve: true }));
    assert.equal(yes.status, "waiting");
    assert.equal(shown.at(-1)?.title, "Say yes to: Send 6 NEAR to bob.testnet");
  } finally {
    Date.now = realNow;
    phone.close();
    theirs.close();
  }
});
