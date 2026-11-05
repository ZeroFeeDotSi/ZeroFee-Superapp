// account.keyProof (the "Your key" proof card, L6): a match only when both nodes list this device's key and, for a chip
// key, the chip itself gave the same key just now. Every other case is not a match, or a Problem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore, shortFingerprint, type KeyProof } from "./demo-core.ts";
import type { PlainWords } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { SoftwareKey, type AccountKey, type DeviceKeys } from "./device-key.ts";
import { handleOf } from "./dev-signer.ts";

const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};

function sheet(core: Bridge) {
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
}

/** A stand-in chip key: a software key that answers proof() as the phone's chip would (`gives`: the key it gives now). */
function chipKeys(proof: (k: SoftwareKey) => { publicKey: string; held: boolean; madeAtIso?: string } | Error): DeviceKeys {
  let key: AccountKey | null = null;
  const wrap = (k: SoftwareKey): AccountKey => ({
    kind: "secure-chip",
    publicKey: k.publicKey,
    publicKeyHandle: k.publicKeyHandle,
    signHash: (h) => k.signHash(h),
    proof: async () => {
      const p = proof(k);
      if (p instanceof Error) throw p;
      return p;
    },
  });
  return { make: async () => (key ??= wrap(SoftwareKey.generate())), get: async () => key, forget: async () => {} };
}

async function ready(chain: FakeChain, deviceKeys?: DeviceKeys) {
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, ...(deviceKeys ? { deviceKeys } : {}) });
  sheet(core);
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  return core;
}

test("a browser key on the account, read from two nodes: a match, each node named, never the word chip", async () => {
  const core = await ready(new FakeChain());
  const p = ok(await core.call<KeyProof>("account.keyProof"));
  assert.equal(p.kind, "development");
  assert.equal(p.matches, true);
  assert.deepEqual(p.nodes, [{ node: "node-1.fake", found: true }, { node: "node-2.fake", found: true }]);
  assert.match(p.fingerprint, /^.{6}….{4}$/);
  assert.equal(p.chipFingerprint, undefined);
  core.close();
});

test("one node that doesn't list the key: not a match", async () => {
  const chain = new FakeChain();
  const core = await ready(chain);
  chain.keyReads = [(k) => k, () => []];
  const p = ok(await core.call<KeyProof>("account.keyProof"));
  assert.equal(p.matches, false);
  assert.deepEqual(p.nodes.map((n) => n.found), [true, false]);
  core.close();
});

test("one read only (no second node): never a match", async () => {
  const chain = new FakeChain();
  const core = await ready(chain);
  chain.keyReads = [(k) => k];
  assert.equal(ok(await core.call<KeyProof>("account.keyProof")).matches, false);
  core.close();
});

test("the chip key: a match with its date and the chip's own key; the chip giving another key or none is not", async () => {
  const made = "2026-11-01T10:00:00.000Z";
  let mode: "same" | "other" | "gone" | "throws" = "same";
  const other = SoftwareKey.generate();
  const keys = chipKeys((k) => (mode === "throws" ? new Error("no chip") : mode === "same" ? { publicKey: k.publicKey, held: true, madeAtIso: made } : mode === "other" ? { publicKey: other.publicKey, held: false } : { publicKey: k.publicKey, held: false }));
  const core = await ready(new FakeChain(), keys);
  const p = ok(await core.call<KeyProof>("account.keyProof"));
  assert.equal(p.kind, "secure-chip");
  assert.equal(p.matches, true);
  assert.equal(p.madeAtIso, made);
  assert.equal(p.chipFingerprint, p.fingerprint);
  mode = "other";
  const q = ok(await core.call<KeyProof>("account.keyProof"));
  assert.equal(q.matches, false);
  assert.equal(q.chipFingerprint, shortFingerprint(handleOf(other.publicKey)));
  mode = "gone";
  assert.equal(ok(await core.call<KeyProof>("account.keyProof")).matches, false);
  mode = "throws";
  const r = await core.call<KeyProof>("account.keyProof");
  assert.ok("problem" in r && r.problem.code === "security.key.chip-unread");
  core.close();
});

test("no account yet: a Problem, never a proof", async () => {
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }) });
  const r = await core.call<KeyProof>("account.keyProof");
  assert.ok("problem" in r);
  core.close();
});

test("H34: account.state gives the set-up window's end, about a day after the account was made", async () => {
  const core = await ready(new FakeChain());
  const s = ok(await core.call<{ setupUntilIso?: string }>("account.state"));
  const left = Date.parse(s.setupUntilIso ?? "") - Date.now();
  assert.ok(left > 86_000_000 && left <= 86_400_000, `about 24 hours left, got ${left}`);
  core.close();
});
