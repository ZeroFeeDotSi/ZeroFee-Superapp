import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "./device-key.ts";
import { RequestError, actionsFromRequest, sameTransaction, serialize } from "./tx-build.ts";
import type { CoreAction, UnsignedTx } from "./tx-build.ts";
import { DecodeError, decodeTransaction } from "./tx-decode.ts";
import { formatNear, formatNearShort, plainWords } from "./words.ts";
import type { WordsContext } from "./words.ts";
import { FEE_RESERVE_YOCTO, YOCTO_PER_BYTE, availableYocto } from "./near-available.ts";

const key = SoftwareKey.generate();
const other = SoftwareKey.generate();
const NEAR = 10n ** 24n;
const tx = (actions: CoreAction[], receiverId = "bob.testnet"): UnsignedTx => ({
  signerId: "alice.testnet",
  publicKey: key.publicKey,
  nonce: 7n,
  receiverId,
  blockHash: toBase58(new Uint8Array(32).fill(9)),
  actions,
});
const ctx: WordsContext = { network: "testnet", balanceYocto: 10n * NEAR, gasPriceYocto: 100_000_000n, knownRecipients: new Set() };

test("every kind of step decodes back to exactly what was built", () => {
  const built = tx([
    { kind: "transfer", yocto: 1n },
    { kind: "call", method: "ft_transfer", args: new TextEncoder().encode('{"amount":"5"}'), gas: 30_000_000_000_000n, depositYocto: 1n },
    { kind: "add-key", publicKey: other.publicKey, permission: { kind: "full" } },
    { kind: "add-key", publicKey: other.publicKey, permission: { kind: "function-call", receiverId: "alice.testnet", methods: ["start_recovery", "finish_recovery"], allowanceYocto: NEAR / 4n } },
    { kind: "add-key", publicKey: other.publicKey, permission: { kind: "function-call", receiverId: "alice.testnet", methods: [], allowanceYocto: null } },
    { kind: "delete-key", publicKey: other.publicKey },
    { kind: "deploy", code: new Uint8Array([0, 97, 115, 109]) },
  ]);
  const decoded = decodeTransaction(serialize(built));
  assert.ok(sameTransaction(decoded, built));
  assert.equal(decoded.publicKey.text, key.publicKey);
  assert.equal(decoded.publicKey.handle, key.publicKeyHandle);
});

function assertTamperCaught(built: UnsignedTx, positions: Iterable<number>) {
  const bytes = serialize(built);
  for (const i of positions) {
    const tampered = bytes.slice();
    tampered[i] ^= 0x01;
    let caught = false;
    try {
      caught = !sameTransaction(decodeTransaction(tampered), built);
    } catch (e) {
      caught = e instanceof DecodeError;
    }
    assert.ok(caught, `byte ${i} of ${bytes.length} changed without being noticed`);
  }
}

test("a change to any single byte is caught before signing", () => {
  // Every byte of a transaction signed by a short (classical) key: the checks don't depend on the key type.
  const classical = { ...tx([{ kind: "transfer", yocto: 123_456_789n }, { kind: "call", method: "go", args: new TextEncoder().encode("{}"), gas: 1n, depositYocto: 0n }]), publicKey: "ed25519:11111111111111111111111111111112" };
  assertTamperCaught(classical, Array.from(serialize(classical).keys()));
  // And a sample across a post-quantum transaction, including its 1,952-byte key (base58 of it is slow to check all).
  const pq = tx([{ kind: "transfer", yocto: 5n }]);
  const length = serialize(pq).length;
  assertTamperCaught(pq, Array.from({ length: 60 }, (_, i) => Math.floor((i * length) / 60)));
});

test("unknown steps, extra bytes and cut-off transactions are refused, never guessed", () => {
  const bytes = serialize(tx([{ kind: "transfer", yocto: 5n }]));
  assert.throws(() => decodeTransaction(new Uint8Array([...bytes, 0])), DecodeError);
  assert.throws(() => decodeTransaction(bytes.subarray(0, bytes.length - 1)), DecodeError);
  for (const tag of [8, 9, 10, 11, 12, 13, 99]) {
    const unknown = bytes.slice();
    unknown[bytes.length - 17] = tag; // the transfer's action tag, before its 16-byte amount
    assert.throws(() => decodeTransaction(unknown), DecodeError, `action tag ${tag}`);
  }
});

test("apps may ask only for transfers and calls, with amounts as whole numbers in text", () => {
  const ok = { receiverId: "bob.testnet", why: "", from: "wallet" as const };
  assert.deepEqual(actionsFromRequest({ ...ok, actions: [{ kind: "transfer", yocto: "1000" }] }), [{ kind: "transfer", yocto: 1000n }]);
  for (const yocto of ["1.5", "-1", "1e24", " 1", "1 NEAR", "", "0x10", "1".repeat(40)]) {
    assert.throws(() => actionsFromRequest({ ...ok, actions: [{ kind: "transfer", yocto }] }), RequestError, `amount ${JSON.stringify(yocto)}`);
  }
  assert.throws(() => actionsFromRequest({ ...ok, actions: [{ kind: "transfer", yocto: 1 as any }] }), RequestError);
  assert.throws(() => actionsFromRequest({ ...ok, actions: [{ kind: "add-key" } as any] }), RequestError);
  assert.throws(() => actionsFromRequest({ ...ok, receiverId: "Bob!", actions: [{ kind: "transfer", yocto: "1" }] }), RequestError);
  assert.throws(() => actionsFromRequest({ ...ok, actions: [] }), RequestError);
  const call = (over: object) => ({ ...ok, actions: [{ kind: "call", method: "go", args: {}, depositYocto: "0", gas: "1", ...over } as any] });
  assert.throws(() => actionsFromRequest(call({ method: "bad name" })), RequestError);
  assert.throws(() => actionsFromRequest(call({ args: [] })), RequestError);
  assert.throws(() => actionsFromRequest(call({ gas: "300000000000001" })), RequestError);
  assert.throws(() => actionsFromRequest(call({ gas: "0" })), RequestError);
});

test("amounts that move are exact; balances and fee bounds are short, rounded so the bound stays true", () => {
  assert.equal(formatNear(1n), "0.000000000000000000000001");
  assert.equal(formatNear(NEAR), "1");
  assert.equal(formatNear(1234n * NEAR + NEAR / 2n), "1,234.5");
  assert.equal(formatNear(0n), "0");
  const balance = 9_999_012_348_659_197_000_000_000n; // 9.999012348659197 NEAR
  assert.equal(formatNearShort(balance, "down"), "9.999");
  assert.equal(formatNearShort(balance, "up"), "9.9991");
  assert.equal(formatNearShort(1234n * NEAR + 567_890_000_000_000_000_000_000n, "down"), "1,234.5678");
  assert.equal(formatNearShort(996_000_000_000_000_000_000n, "up"), "0.000996");
  assert.equal(formatNearShort(996_100_000_000_000_000_000n, "up"), "0.000997");
  assert.equal(formatNearShort(1n, "down"), "0.000000000000000000000001");
  // A shortfall reads as one, never "0" (audit, Low); "down" (the worst case) rounds its size up.
  assert.equal(formatNearShort(-5n, "down"), "-0.000000000000000000000005");
  assert.equal(formatNearShort(-1_234_567_000_000_000_000_000n, "down"), "-0.00124");
  assert.equal(formatNearShort(-1_234_567_000_000_000_000_000n, "up"), "-0.00123");
  assert.equal(formatNearShort(0n, "down"), "0");
});

test("a transfer says who gets how much, warns about a first-time recipient and large amounts, and shows the fee", () => {
  const words = plainWords(decodeTransaction(serialize(tx([{ kind: "transfer", yocto: 6n * NEAR }]))), { ...ctx, hint: "Wallet says: rent" });
  assert.equal(words.title, "Send 6 NEAR to bob.testnet");
  assert.deepEqual(words.warnings.map((w) => w.kind), ["first-time-recipient", "large-amount"]);
  // One step: the title says it, so the only line is where it comes from and the fee bound.
  // The network is the sheet's one "Test network" mark, never a line's words (grade 02h, H10).
  assert.deepEqual(words.lines, ["From alice.testnet. Fee: at most 0.001 NEAR."]);
  assert.equal(words.testNetwork, true);
  assert.equal(plainWords(decodeTransaction(serialize(tx([{ kind: "transfer", yocto: NEAR }]))), { ...ctx, network: "mainnet" }).testNetwork, undefined);
  assert.equal(words.effect[0].before, "10");
  assert.equal(words.hint, "Wallet says: rent");
  const again = plainWords(decodeTransaction(serialize(tx([{ kind: "transfer", yocto: NEAR }]))), { ...ctx, knownRecipients: new Set(["bob.testnet"]) });
  assert.deepEqual(again.warnings, []);
});

test("grade 01c P6: the sheet's NEAR line is the NEAR the person can use, the Safe's own figure, not the balance with storage", () => {
  // The grader's account: 9.9941 NEAR on chain, ~264 kB of storage (2.64 NEAR locked), so the Safe showed 7.29.
  const acct = { balanceYocto: 9_994_100_000_000_000_000_000_000n, storageBytes: 263_967n };
  const usable = availableYocto(acct);
  assert.equal(usable, acct.balanceYocto - 263_967n * YOCTO_PER_BYTE - FEE_RESERVE_YOCTO);
  const words = plainWords(decodeTransaction(serialize(tx([{ kind: "transfer", yocto: NEAR / 100n }]))), { ...ctx, balanceYocto: acct.balanceYocto, availableYocto: usable });
  assert.equal(words.effect[0].before, formatNearShort(usable, "down"));
  assert.match(words.effect[0].before, /^7\.29/);
  // Sending everything that's usable never shows a figure below zero.
  const all = plainWords(decodeTransaction(serialize(tx([{ kind: "transfer", yocto: usable }]))), { ...ctx, balanceYocto: acct.balanceYocto, availableYocto: usable });
  assert.equal(all.effect[0].after, "0");
  assert.equal(availableYocto({ balanceYocto: NEAR / 100n, storageBytes: 0n }), 0n);
});

test("unknown contracts and key changes always carry a warning", () => {
  const callWords = plainWords(decodeTransaction(serialize(tx([{ kind: "call", method: "swap", args: new TextEncoder().encode('{"a":1}'), gas: 1n, depositYocto: 0n }]))), ctx);
  assert.deepEqual(callWords.warnings.map((w) => w.kind), ["unknown-contract", "effect-unknown"]);
  assert.ok(callWords.lines.includes('With: {"a":1}'));
  const backup = plainWords(
    decodeTransaction(serialize(tx([{ kind: "add-key", publicKey: other.publicKey, permission: { kind: "function-call", receiverId: "alice.testnet", methods: ["start_recovery", "finish_recovery"], allowanceYocto: NEAR / 4n } }], "alice.testnet"))),
    ctx,
  );
  assert.equal(backup.title, "Add your backup words to your account");
  assert.equal(backup.lines.length, 4);
  assert.ok(backup.lines.includes("It can't send money. It can spend at most 0.25 NEAR, on fees only."));
  assert.deepEqual(backup.warnings.map((w) => w.kind), ["key-change"]);
});
