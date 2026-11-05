import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { openLink, readCode, sealForLink } from "./link.ts";
import { seal, unseal, PURPOSE } from "./seal.ts";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const seed = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const CODE = "7KQ2M9XD4R";                                                     // made by the phone (subwallet.linkStart)

test("the QR holds no seed and no code: only v, salt, iv and ciphertext", async () => {
  const qr = (await sealForLink(seed, CODE, FAST))!;
  const payload = JSON.parse(new TextDecoder().decode(fromBase64(qr)));
  assert.deepEqual(Object.keys(payload).sort(), ["ct", "iv", "salt", "v"]);
  assert.equal(payload.v, 1);
  assert.ok(!qr.includes(CODE));
  assert.ok(qr.length < 300, "small enough for a calm QR");
});

test("typed loosely on the laptop, the phone's code still opens it; another code doesn't", async () => {
  const qr = (await sealForLink(seed, " 7kq2m-9xd4r ", FAST))!;
  assert.deepEqual(await openLink(qr, CODE, FAST), seed);
  assert.equal(await openLink(qr, "7KQ2M9XD4S", FAST), null);
  assert.equal(await openLink("bm90IGpzb24=", CODE, FAST), null);
  assert.equal(await sealForLink(seed, "7KQ2M9XD4", FAST), null, "not a code: nothing is sealed");
});

test("at full cost: scrypt N=2^17 by default", async () => {
  const qr = (await sealForLink(seed, CODE))!;
  assert.deepEqual(await openLink(qr, CODE), seed);
});

test("codes: 10 characters of Crockford base32; O, I and L read as 0, 1 and 1", () => {
  assert.equal(readCode("7kq2m-9xd4r"), "7KQ2M9XD4R");
  assert.equal(readCode("O0IL1-ABCDE"), "00111ABCDE");
  assert.equal(readCode("7KQ2M9XD4"), null);
  assert.equal(readCode("7KQ2M9XD4U"), null);
});

test("a link blob and a vault blob can't be swapped", async () => {
  const v = await seal(seed, CODE, FAST, PURPOSE.vault);
  assert.equal(await unseal(v, CODE, PURPOSE.link), null);
  assert.deepEqual(await unseal(v, CODE, PURPOSE.vault), seed);
});
