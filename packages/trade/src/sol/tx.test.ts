// The transaction builder must produce the very bytes @solana/web3.js 1.99 produces (fixtures/web3-vectors.json, made by
// that library from fixed seeds): account order, header counts, instruction encoding, compute budget and SOL transfers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64, fromBase64 } from "./bytes.ts";
import { ataOf, pda } from "./keys.ts";
import { buildTx, compileV0, computeLimit, computePrice, messageOf, transfer, unsignedTx, type Instruction } from "./tx.ts";

const v = JSON.parse(readFileSync(new URL("./fixtures/web3-vectors.json", import.meta.url), "utf8"));
const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));

test("40 token accounts and 40 PDAs equal web3.js's findProgramAddressSync", () => {
  for (const a of v.atas) assert.equal(ataOf(a.owner, a.mint, a.program), a.ata);
  for (const p of v.pdas) assert.equal(pda(p.seeds.map(hex), p.program), p.address);
});

test("12 v0 transactions with mixed signers, writable flags and repeated accounts equal web3.js's bytes", () => {
  for (const t of v.txs) {
    const ixs: Instruction[] = t.instructions.map((i: { programId: string; keys: Instruction["keys"]; data: string }) => ({ programId: i.programId, keys: i.keys, data: hex(i.data) }));
    assert.equal(base64(unsignedTx(compileV0(t.payer, t.blockhash, ixs))), t.tx);
    assert.deepEqual(messageOf(t.tx), compileV0(t.payer, t.blockhash, ixs));
  }
});

test("the compute budget and transfer instructions are the system programs' own encodings", () => {
  const t = v.txs[0];
  const ixs = t.instructions;
  assert.equal(Buffer.from(computeLimit(200_000).data).toString("hex"), ixs[0].data);
  assert.equal(Buffer.from(computePrice(50_000n).data).toString("hex"), ixs[1].data);
  const last = ixs.at(-1);
  assert.deepEqual(transfer(last.keys[0].pubkey, last.keys[1].pubkey, 123_456_789n), { programId: last.programId, keys: last.keys, data: hex(last.data) });
});

test("a transaction over Solana's 1,232-byte limit is refused, never handed on", () => {
  const big = v.txs.find((t: { tx: string }) => fromBase64(t.tx).length > 1232);
  assert.ok(big, "the vectors include one over the limit");
  const ixs = big.instructions.map((i: { programId: string; keys: Instruction["keys"]; data: string }) => ({ ...i, data: hex(i.data) }));
  assert.throws(() => buildTx(big.payer, big.blockhash, ixs), /too large/);
  const small = v.txs[0];
  assert.equal(buildTx(small.payer, small.blockhash, small.instructions.map((i: { programId: string; keys: Instruction["keys"]; data: string }) => ({ ...i, data: hex(i.data) }))), small.tx);
});
