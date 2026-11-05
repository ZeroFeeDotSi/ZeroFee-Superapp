// Test vectors for the native sheet's transaction check (NearTx.swift): real bytes from the core's own serializer,
// plus the look-alikes the chip must never sign. Run by run.sh.
import { writeFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { SoftwareKey } from "../../../packages/core/src/device-key.ts";
import { serialize } from "../../../packages/core/src/tx-build.ts";
import { executeArgs } from "../../../packages/core/src/dev-signer.ts";
import { sheetSummary } from "../../../packages/core/src/sheet-summary.ts";
const out = process.argv[2];
const mine = SoftwareKey.generate();
const other = SoftwareKey.generate();
const tx = (pk: string, actions: any[] = [{ kind: "transfer", yocto: 10n ** 24n }]) =>
  serialize({ signerId: "alice.near", publicKey: pk, nonce: 7n, receiverId: "alice.near", blockHash: "11111111111111111111111111111111", actions });
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const valid = tx(mine.publicKey);
// NEP-366 delegate action: u32 prefix 2^30 + 366, then sender_id, receiver_id, actions, nonce, max_block_height, public_key.
const tag = new Uint8Array(4); new DataView(tag.buffer).setUint32(0, 2 ** 30 + 366, true);
const delegate = new Uint8Array([...tag, ...valid]);
// NEP-413: u32 prefix 2^31 + 413, then the message.
const t413 = new Uint8Array(4); new DataView(t413.buffer).setUint32(0, 2 ** 31 + 413, true);
const nep413 = new Uint8Array([...t413, ...valid.slice(0, 40)]);
const noActions = tx(mine.publicKey, []);
// iOS audit finding 1: transactions with the summary the core hands the native sheet (sheet-summary.ts).
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const withSummary = (receiverId: string, actions: any[]) => {
  const t = { signerId: "alice.near", publicKey: mine.publicKey, nonce: 7n, receiverId, blockHash: "11111111111111111111111111111111", actions };
  return { bytes: hex(serialize(t)), summary: JSON.stringify(sheetSummary(t)) };
};
const pay = withSummary("bob.near", [{ kind: "transfer", yocto: 1_500_000_000_000_000_000_000_000n }]);
const coin = [{ kind: "call", method: "ft_transfer", args: enc({ receiver_id: "bob.near", amount: "5000000" }), gas: 30_000_000_000_000n, depositYocto: 1n }];
const wrapped = withSummary("alice.near", [{ kind: "call", method: "execute", args: enc(executeArgs("usdc.near", coin as any)), gas: 80_000_000_000_000n, depositYocto: 0n }]);
const many = withSummary("alice.near", [{ kind: "call", method: "execute_many", args: enc({ groups: [executeArgs("bob.near", [{ kind: "transfer", yocto: 2n * 10n ** 24n }]), executeArgs("usdc.near", coin as any)] }), gas: 100_000_000_000_000n, depositYocto: 0n }]);
const keys = withSummary("alice.near", [{ kind: "add-key", publicKey: other.publicKey, permission: { kind: "full" } }, { kind: "add-key", publicKey: "ed25519:11111111111111111111111111111111", permission: { kind: "function-call", receiverId: "app.near", methods: ["a", "b"], allowanceYocto: null } }, { kind: "delete-key", publicKey: mine.publicKey }]);
writeFileSync(out, JSON.stringify({
  publicKey: hex(decodePublicKey(mine.publicKey as any)),
  valid: hex(valid), validHash: hex(sha256(valid)),
  otherKey: hex(tx(other.publicKey)),
  delegate: hex(delegate), nep413: hex(nep413),
  noActions: hex(noActions),
  hash32: hex(sha256(new Uint8Array([1, 2, 3]))),
  payBytes: pay.bytes, paySummary: pay.summary,
  wrappedBytes: wrapped.bytes, wrappedSummary: wrapped.summary,
  manyBytes: many.bytes, manySummary: many.summary,
  keysBytes: keys.bytes, keysSummary: keys.summary,
  otherKeyText: other.publicKey,
}));
console.log("vectors written; tx bytes:", valid.length);
