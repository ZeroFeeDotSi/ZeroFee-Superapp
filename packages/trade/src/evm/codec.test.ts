// The byte layer must produce the very bytes viem 2.x (the old engine's library) produces: fixtures/viem-vectors.json was
// made by viem from fixed seeds. Calldata of every function the engine encodes, the answers it decodes, RLP, keccak and
// EIP-1559 transactions, unsigned and signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abiDecode, abiEncode, decodeCall, encodeCall, topicOf, type AbiValue } from "./abi.ts";
import { fromHex, keccakHex, toHex } from "./bytes.ts";
import { rlpDecode, rlpEncode, type Rlp } from "./rlp.ts";
import { parseTx, signedBytes, txHashOf, unsignedBytes, unsignedTx, type Eip1559 } from "./tx.ts";

const v = JSON.parse(readFileSync(new URL("./fixtures/viem-vectors.json", import.meta.url), "utf8"));
/** The vectors write bigints as { big: "…" }. */
const val = (x: unknown): AbiValue => (Array.isArray(x) ? x.map(val) : x && typeof x === "object" && "big" in x ? BigInt((x as { big: string }).big) : (x as AbiValue));

test(`${v.calls.length} calls to the engine's ${new Set(v.calls.map((c: { sig: string }) => c.sig)).size} functions encode to viem's calldata and decode back`, () => {
  for (const c of v.calls) {
    const args = c.args.map(val);
    assert.equal(encodeCall(c.sig, args), c.data, c.sig);
    assert.deepEqual(decodeCall(c.sig, c.data), args, c.sig);
  }
});

test(`${v.params.length} abi.encode vectors (answers the engine reads: tuples, arrays, strings, signed ints) both ways`, () => {
  for (const p of v.params) {
    const values = p.values.map(val);
    assert.equal(abiEncode(p.types, values), p.data, p.types.join(","));
    assert.deepEqual(abiDecode(p.types, p.data), values, p.types.join(","));
  }
});

test("a malformed answer is refused, never misread: offsets and lengths past the end, dirty addresses", () => {
  assert.throws(() => abiDecode(["bytes"], "0x" + "00".repeat(31) + "40"), /past the end/);
  assert.throws(() => abiDecode(["uint256[]"], "0x" + "00".repeat(31) + "20" + "ff".repeat(32)), /too long|past the end/);
  assert.throws(() => abiDecode(["address"], "0x" + "11".repeat(32)), /dirty/);
  assert.throws(() => abiDecode(["uint8"], "0x" + "00".repeat(31)), /past the end/);
  assert.equal(decodeCall("approve(address,uint256)", "0x12345678" + "00".repeat(64)), undefined, "another function's selector");
});

test(`${v.rlps.length} RLP items equal viem's toRlp, and decode back; a non-minimal length is refused`, () => {
  const item = (x: unknown): Rlp => (Array.isArray(x) ? x.map(item) : fromHex(x as string));
  const hexOf = (x: Rlp): unknown => (x instanceof Uint8Array ? toHex(x) : x.map(hexOf));
  for (const r of v.rlps) {
    assert.equal(toHex(rlpEncode(item(r.item))), r.rlp);
    assert.deepEqual(hexOf(rlpDecode(fromHex(r.rlp))), r.item === "0x00" ? "0x00" : r.item);
  }
  assert.throws(() => rlpDecode(fromHex("0x8105")), /non-minimal/);
  assert.throws(() => rlpDecode(fromHex("0xb800")), /non-minimal/);
  assert.throws(() => rlpDecode(fromHex("0x8205")), /short/);
});

test(`${v.txs.length} EIP-1559 transactions: unsigned and signed bytes equal viem's serializeTransaction, and read back`, () => {
  for (const t of v.txs) {
    const tx: Eip1559 = { chainId: t.tx.chainId, nonce: t.tx.nonce, maxPriorityFeePerGas: BigInt(t.tx.maxPriorityFeePerGas), maxFeePerGas: BigInt(t.tx.maxFeePerGas), gas: BigInt(t.tx.gas), to: t.tx.to, value: BigInt(t.tx.value), data: t.tx.data };
    assert.equal(toHex(unsignedBytes(tx)), t.unsigned);
    assert.equal(Buffer.from(unsignedTx(tx), "base64").toString("hex"), t.unsigned.slice(2));
    const sig = { yParity: t.sig.yParity, r: BigInt(t.sig.r), s: BigInt(t.sig.s) };
    assert.equal(toHex(signedBytes(tx, sig)), t.signed);
    assert.equal(txHashOf(fromHex(t.signed)), t.hash);
    assert.deepEqual(parseTx(t.unsigned), tx);
    assert.deepEqual(parseTx(t.signed), { ...tx, signature: sig });
    assert.deepEqual(parseTx(unsignedTx(tx)), tx, "base64 in");
  }
});

test("keccak-256 and event topics equal viem's", () => {
  for (const k of v.keccaks) assert.equal(keccakHex(k.data), k.hash);
  for (const e of v.events) {
    const sig = e.sig.replace(/^event /, "").replace(/\s+indexed/g, "").replace(/ \w+(?=[,)])/g, "").replace(/,\s+/g, ",");
    assert.equal(topicOf(sig), e.topic, sig);
  }
});

test("a transaction with a tip above its fee cap, or a bad address, is refused, never built", () => {
  const base: Eip1559 = { chainId: 56, nonce: 0, maxPriorityFeePerGas: 1n, maxFeePerGas: 1n, gas: 21_000n, to: "0x" + "11".repeat(20), value: 0n, data: "0x" };
  assert.throws(() => unsignedBytes({ ...base, maxPriorityFeePerGas: 2n }), /tip above/);
  assert.throws(() => unsignedBytes({ ...base, to: "0x1234" }), /not an address/);
  assert.throws(() => parseTx("0x01" + "c0"), /not an EIP-1559/);
});
