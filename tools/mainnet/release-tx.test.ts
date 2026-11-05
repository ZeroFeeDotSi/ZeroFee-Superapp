// release-tx.ts writes every action the core also writes exactly as the core does (tx-build.ts serialize), and the two
// global actions as nearcore 2.13.4 reads them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyFromRandom, publicKeyFromPrivate, signHash, toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { serialize, signedBase64, type CoreAction } from "../../packages/core/src/tx-build.ts";
import { releaseTxBytes, signedReleaseTx, type ReleaseTx } from "./release-tx.ts";

const setup = publicKeyFromPrivate(privateKeyFromRandom());
const device = SoftwareKey.generate().publicKey;
const base = { signerId: "a".repeat(64), publicKey: setup, nonce: 123_456_789n, receiverId: "a".repeat(64), blockHash: toBase58(new Uint8Array(32).fill(7)) };

test("every action the core writes, release-tx writes byte for byte the same", () => {
  const actions: CoreAction[] = [
    { kind: "transfer", yocto: 300_000_000_000_000_000_000_000n },
    { kind: "add-key", publicKey: device, permission: { kind: "function-call", receiverId: "a".repeat(64), methods: ["execute", "run"], allowanceYocto: null } },
    { kind: "add-key", publicKey: device, permission: { kind: "function-call", receiverId: "x.near", methods: [], allowanceYocto: 250_000_000_000_000_000_000_000n } },
    { kind: "add-key", publicKey: setup, permission: { kind: "full" } },
    { kind: "deploy", code: new Uint8Array([0, 97, 115, 109, 1]) },
    { kind: "call", method: "new", args: new TextEncoder().encode('{"recovery_delay_seconds":"60"}'), gas: 100_000_000_000_000n, depositYocto: 1n },
    { kind: "delete-key", publicKey: setup },
    { kind: "delete-key", publicKey: device },
  ];
  const ours = releaseTxBytes({ ...base, actions });
  assert.deepEqual(ours, serialize({ ...base, actions }));
  const sig = new Uint8Array(64).fill(9);
  assert.equal(signedReleaseTx(ours, sig), signedBase64({ ...base, actions }, sig));
});

test("the two global actions: 9 with the code and mode CodeHash (0); 10 with identifier CodeHash (0) and the 32-byte hash", () => {
  const code = new Uint8Array([1, 2, 3]);
  const hash = new Uint8Array(32).fill(5);
  const head = releaseTxBytes({ ...base, actions: [] }).length;
  const deploy = releaseTxBytes({ ...base, actions: [{ kind: "deploy-global", code }] } as ReleaseTx);
  assert.deepEqual([...deploy.slice(head)], [9, 3, 0, 0, 0, 1, 2, 3, 0]);
  const use = releaseTxBytes({ ...base, actions: [{ kind: "use-global", codeHash: hash }] } as ReleaseTx);
  assert.deepEqual([...use.slice(head)], [10, 0, ...hash]);
  assert.throws(() => releaseTxBytes({ ...base, actions: [{ kind: "use-global", codeHash: new Uint8Array(31) }] } as ReleaseTx));
  const gone = releaseTxBytes({ ...base, actions: [{ kind: "delete-account", beneficiaryId: "me.near" }] } as ReleaseTx);
  assert.deepEqual([...gone.slice(head)], [7, 7, 0, 0, 0, ...new TextEncoder().encode("me.near")]);
  // The action count is the vector's length: one action.
  assert.deepEqual([...deploy.slice(head - 4, head)], [1, 0, 0, 0]);
});

test("a signature is over sha256 of the bytes, and a signed transaction is the bytes, ed25519's 0, the signature", async () => {
  const priv = privateKeyFromRandom();
  const bytes = releaseTxBytes({ ...base, publicKey: publicKeyFromPrivate(priv), actions: [{ kind: "transfer", yocto: 1n }] });
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const sig = signHash(sha256(bytes), priv) as Uint8Array;
  const signed = Buffer.from(signedReleaseTx(bytes, sig), "base64");
  assert.deepEqual([...signed.subarray(0, bytes.length)], [...bytes]);
  assert.equal(signed[bytes.length], 0);
  assert.equal(signed.length, bytes.length + 65);
});
