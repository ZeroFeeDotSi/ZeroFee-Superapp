import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { decodePublicKey, encodePublicKey, publicKeyToHandle, type MlDsa65PublicKey } from "@fastnear/ml-dsa-65";
import { toBase58 } from "@fastnear/utils";
import { base58Decode, base58Encode, handlesWorkedOut, keyHandle, mlDsaKeyHandle, mlDsaPublicKeyBytes } from "./key-handle.ts";
import { SoftwareKey, vaultDeviceKeys } from "./device-key.ts";
import { DemoCore } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import type { PlainWords } from "./signer.ts";

test("base58: the same text as the library's for keys, hashes, leading zeros and the empty case, and back", () => {
  const cases: Uint8Array[] = [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([0, 0, 1]), new Uint8Array([57]), new Uint8Array([58]), new Uint8Array([255, 255])];
  for (let i = 0; i < 40; i++) cases.push(new Uint8Array(randomBytes(1 + (i * 7) % 70)));
  for (let i = 0; i < 12; i++) {
    const k = new Uint8Array(randomBytes(1952));
    if (i % 3 === 0) k.fill(0, 0, i + 1);
    cases.push(k);
  }
  for (const bytes of cases) {
    const text = base58Encode(bytes);
    assert.equal(text, toBase58(bytes), `encode ${bytes.length} bytes`);
    assert.deepEqual(base58Decode(text), bytes, `decode ${bytes.length} bytes`);
  }
  assert.throws(() => base58Decode("0OIl"), /not base58/);
});

test("key handles: the library's own, fast, worked out once per key; a bad key throws as the library does", () => {
  for (let i = 0; i < 6; i++) {
    const pk = encodePublicKey(new Uint8Array(randomBytes(1952)));
    assert.equal(mlDsaKeyHandle(pk), publicKeyToHandle(pk));
    assert.deepEqual(mlDsaPublicKeyBytes(pk), decodePublicKey(pk));
  }
  assert.equal(keyHandle("ed25519:abc"), "ed25519:abc");
  assert.throws(() => mlDsaKeyHandle("ml-dsa-65:"), /empty/);
  assert.throws(() => mlDsaKeyHandle("ml-dsa-65:1" + encodePublicKey(new Uint8Array(randomBytes(1952))).slice(10)), /bytes|canonical/);
  assert.throws(() => mlDsaKeyHandle("ed25519:x"));

  const pk = encodePublicKey(new Uint8Array(randomBytes(1952))) as MlDsa65PublicKey;
  let t = performance.now();
  mlDsaKeyHandle(pk);
  const cold = performance.now() - t;
  const before = handlesWorkedOut();
  t = performance.now();
  for (let i = 0; i < 1000; i++) mlDsaKeyHandle(pk);
  const warm = (performance.now() - t) / 1000;
  assert.equal(handlesWorkedOut(), before, "a kept key is never worked out again");
  // wall time under land.sh's parallel load swings 10x, so the bound is loose and the cache is proven by the ratio
  assert.ok(cold < 150, `a new key's handle in ${cold.toFixed(1)} ms (the library's took about 40)`);
  assert.ok(warm < 1 && warm * 20 < cold, `a known key's handle in ${warm.toFixed(3)} ms (cold ${cold.toFixed(1)} ms)`);
});

test("the device key is built once per unlock: a locked vault drops it, a new seed replaces it", async () => {
  const vault = new MemoryVault();
  const keys = vaultDeviceKeys(vault);
  const made = await keys.make();
  let built = 0;
  const real = SoftwareKey.fromSeed;
  SoftwareKey.fromSeed = (seed, kind) => (built++, real.call(SoftwareKey, seed, kind));
  try {
    for (let i = 0; i < 20; i++) assert.equal(await keys.get(), made);
    assert.equal(built, 0, "the key made here is the key read back");
    // Locked: the vault can't answer.
    const get = vault.get.bind(vault);
    vault.get = async () => { throw new Error("locked"); };
    await assert.rejects(keys.get());
    vault.get = get;
    const again = await keys.get();
    assert.equal(built, 1, "built again once after the unlock");
    assert.equal(again!.publicKey, made.publicKey);
    for (let i = 0; i < 20; i++) assert.equal(await keys.get(), again);
    assert.equal(built, 1);
    await vault.put("device-seed", SoftwareKey.generate().exportSeed());
    assert.notEqual((await keys.get())!.publicKey, made.publicKey, "a new seed is a new key");
    await keys.forget();
    assert.equal(await keys.get(), null);
  } finally {
    SoftwareKey.fromSeed = real;
  }
});

test("perf: N account reads after unlock never rebuild the key or work out its handle again (grade 1 Nov b, N1)", async () => {
  const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  try {
    assert.ok("ok" in (await core.call("account.create")));
    const w = await core.call<{ words: string[] }>("recovery.words");
    assert.ok("ok" in w);
    assert.ok("ok" in (await core.call("recovery.confirm", { positions: [1, 12, 24], words: [w.ok.words[0], w.ok.words[11], w.ok.words[23]] })));
    assert.ok("ok" in (await core.call("account.state")));
    let built = 0;
    const real = SoftwareKey.fromSeed;
    SoftwareKey.fromSeed = (seed, kind) => (built++, real.call(SoftwareKey, seed, kind));
    const handles = handlesWorkedOut();
    const t = performance.now();
    try {
      for (let i = 0; i < 50; i++) {
        const r = await core.call<{ stage: string }>("account.state");
        assert.ok("ok" in r && r.ok.stage === "ready");
      }
    } finally {
      SoftwareKey.fromSeed = real;
    }
    const each = (performance.now() - t) / 50;
    assert.equal(built, 0, "no key rebuilt for a read");
    assert.equal(handlesWorkedOut(), handles, "no handle worked out again for a read");
    assert.ok(each < 60, `an account read in ${each.toFixed(1)} ms of CPU (it was about 80 before; loose for a loaded machine)`);

    // Readers asking at once (Wallet's ledger, Earn, the hub) share one account read per block.
    let lists = 0;
    const real2 = chain.accessKeys.bind(chain);
    chain.accessKeys = async (...a: Parameters<typeof chain.accessKeys>) => (lists++, real2(...a));
    try {
      const all = await Promise.all(Array.from({ length: 20 }, () => core.call<{ stage: string }>("account.state")));
      assert.ok(all.every((r) => "ok" in r && r.ok.stage === "ready"));
    } finally {
      chain.accessKeys = real2;
    }
    // D134: at most one: and none when the read just before is still kept (account.state is kept 15 s for every caller)
    assert.ok(lists <= 1, `20 reads at once, ${lists} key-list reads`);
  } finally {
    core.close();
  }
});
