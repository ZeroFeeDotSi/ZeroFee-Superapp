import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fromBase58 } from "@zerofee/trade/sol/bytes.ts";
import { BLOCKHASH } from "@zerofee/trade/sol/testing/replay.ts";
import { buildTx, decodeTx, transfer } from "@zerofee/trade/sol/tx.ts";
import { newSeed, solanaKey, signSolTx } from "./keys.ts";

const seed = new Uint8Array(32).fill(7);

test("the Solana key comes from the seed, the same every time, and differs per seed", () => {
  const a = solanaKey(seed), b = solanaKey(seed), c = solanaKey(newSeed());
  assert.equal(a.address, b.address);
  assert.notEqual(a.address, c.address);
  assert.equal(fromBase58(a.address).length, 32);
  // HKDF-SHA256(seed, salt "zerofee-extension", info "solana/0"), checked against node:crypto's own hkdf and ed25519
  assert.equal(a.address, "61mKCjtjjyngrdVDYJNTc3LDAqYmamrvT8y9yvPyuDxt", "the derivation is fixed: changing it would lose every wallet");
  assert.throws(() => solanaKey(new Uint8Array(31)));
});

test("signing fills this wallet's slot with a signature over the exact message", () => {
  const me = solanaKey(seed).address;
  const unsigned = buildTx(me, BLOCKHASH, [transfer(me, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", 1_000n)]);
  const signed = decodeTx(signSolTx(unsigned, seed));
  const before = decodeTx(unsigned);
  assert.deepEqual(signed.message, before.message);
  assert.equal(signed.signatures.length, 1);
  assert.ok(ed25519.verify(signed.signatures[0]!, signed.message, fromBase58(me)));
});

test("a transaction this wallet doesn't sign is not signed", () => {
  const other = solanaKey(newSeed()).address;
  const unsigned = buildTx(other, BLOCKHASH, [transfer(other, other, 1n)]);
  assert.throws(() => signSolTx(unsigned, seed), /doesn't sign/);
});
