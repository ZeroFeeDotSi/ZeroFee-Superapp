// The summary the phone's native sheet checks against the bytes (iOS audit, finding 1): receiver, steps, and the inner
// receivers of the account's own execute()/execute_many().
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { executeArgs } from "./dev-signer.ts";
import { sheetSummary } from "./sheet-summary.ts";
import type { UnsignedTx } from "./tx-build.ts";

const pk = SoftwareKey.generate().publicKey;
const base = { signerId: "alice.near", publicKey: pk, nonce: 7n, blockHash: "11111111111111111111111111111111" };
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

test("a plain payment: its receiver and amount", () => {
  const tx: UnsignedTx = { ...base, receiverId: "bob.near", actions: [{ kind: "transfer", yocto: 10n ** 24n }] };
  assert.deepEqual(sheetSummary(tx), { receiver: "bob.near", actions: [{ kind: "transfer", deposit: "1000000000000000000000000" }] });
});

test("execute() on the account's own rules: the inner receiver and its steps", () => {
  const inner = [{ kind: "call" as const, method: "ft_transfer", args: enc({ receiver_id: "bob.near", amount: "5" }), gas: 30_000_000_000_000n, depositYocto: 1n }];
  const tx: UnsignedTx = { ...base, receiverId: "alice.near", actions: [{ kind: "call", method: "execute", args: enc(executeArgs("usdc.near", inner)), gas: 80_000_000_000_000n, depositYocto: 0n }] };
  assert.deepEqual(sheetSummary(tx), {
    receiver: "alice.near",
    actions: [{ kind: "call", method: "execute", deposit: "0", gas: "80000000000000" }],
    inner: [{ receiver: "usdc.near", steps: [{ kind: "call", method: "ft_transfer", deposit: "1", gas: "30000000000000" }] }],
  });
});

test("execute_many(): every group in order", () => {
  const groups = [executeArgs("bob.near", [{ kind: "transfer", yocto: 3n }]), executeArgs("carol.near", [{ kind: "transfer", yocto: 4n }])];
  const tx: UnsignedTx = { ...base, receiverId: "alice.near", actions: [{ kind: "call", method: "execute_many", args: enc({ groups }), gas: 100n, depositYocto: 0n }] };
  assert.deepEqual(sheetSummary(tx).inner, [
    { receiver: "bob.near", steps: [{ kind: "transfer", deposit: "3" }] },
    { receiver: "carol.near", steps: [{ kind: "transfer", deposit: "4" }] },
  ]);
});

test("key changes name the key and its access; a call named execute on another account has no inner steps", () => {
  const tx: UnsignedTx = { ...base, receiverId: "alice.near", actions: [{ kind: "add-key", publicKey: pk, permission: { kind: "full" } }, { kind: "delete-key", publicKey: pk }] };
  assert.deepEqual(sheetSummary(tx).actions, [{ kind: "add-key", publicKey: pk, permission: "full" }, { kind: "delete-key", publicKey: pk }]);
  const other: UnsignedTx = { ...base, receiverId: "dex.near", actions: [{ kind: "call", method: "execute", args: enc({}), gas: 1n, depositYocto: 0n }] };
  assert.equal(sheetSummary(other).inner, undefined);
});
