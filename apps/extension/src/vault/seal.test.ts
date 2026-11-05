import { test } from "node:test";
import assert from "node:assert/strict";
import { base64, fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { KDF, seal, unseal } from "./seal.ts";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const secret = Uint8Array.from({ length: 32 }, (_, i) => i);

test("the default is scrypt at N=2^17, r=8, p=1", () => {
  assert.deepEqual(KDF, { N: 2 ** 17, r: 8, p: 1 });
});

test("the right passcode opens it; a wrong one gives nothing", async () => {
  const s = await seal(secret, "correct horse battery", FAST);
  assert.deepEqual(await unseal(s, "correct horse battery"), secret);
  assert.equal(await unseal(s, "correct horse batterY"), null);
  assert.equal(await unseal(s, ""), null);
});

test("any changed byte is refused", async () => {
  const s = await seal(secret, "correct horse battery", FAST);
  const flip = (b64: string) => { const b = fromBase64(b64); b[0]! ^= 1; return base64(b); };
  assert.equal(await unseal({ ...s, ct: flip(s.ct) }, "correct horse battery"), null);
  assert.equal(await unseal({ ...s, iv: flip(s.iv) }, "correct horse battery"), null);
  assert.equal(await unseal({ ...s, salt: flip(s.salt) }, "correct horse battery"), null);
});

test("each seal is new: its own salt and nonce", async () => {
  const a = await seal(secret, "correct horse battery", FAST), b = await seal(secret, "correct horse battery", FAST);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test("the same passcode typed two ways (é composed or not) opens it", async () => {
  const s = await seal(secret, "café au lait 42", FAST);
  assert.deepEqual(await unseal(s, "café au lait 42"), secret);
});

test("parameters out of range are refused, both ways", async () => {
  await assert.rejects(seal(secret, "correct horse battery", { N: 2 ** 9, r: 8, p: 1 }));
  await assert.rejects(seal(secret, "correct horse battery", { N: 3000, r: 8, p: 1 }));
  const s = await seal(secret, "correct horse battery", FAST);
  assert.equal(await unseal({ ...s, N: 2 ** 24 }, "correct horse battery"), null);
  assert.equal(await unseal({ ...s, v: 2 } as never, "correct horse battery"), null);
});
