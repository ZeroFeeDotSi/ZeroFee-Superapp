import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seedToWords, wordsProblem, wordsToSeed } from "./recovery-words.ts";
import { SoftwareKey, signatureIsValid } from "./device-key.ts";

test("24 words round-trip to the same 32-byte seed", () => {
  const seed = new Uint8Array(randomBytes(32));
  const words = seedToWords(seed);
  assert.equal(words.length, 24);
  assert.deepEqual(wordsToSeed(words), seed);
});

test("words rebuild the identical post-quantum key, and it signs", async () => {
  const original = SoftwareKey.generate();
  const words = seedToWords(original.exportSeed());
  const rebuilt = SoftwareKey.fromSeed(wordsToSeed(words), "recovery-words");
  assert.equal(rebuilt.publicKey, original.publicKey);
  const hash = new Uint8Array(randomBytes(32));
  assert.ok(signatureIsValid(hash, await rebuilt.signHash(hash), original.publicKey));
  original.destroy();
  rebuilt.destroy();
});

test("typing mistakes are named precisely, never a generic failure", () => {
  const words = seedToWords(new Uint8Array(randomBytes(32)));
  assert.deepEqual(wordsProblem(words.slice(0, 23)), { kind: "count", got: 23 });
  const misspelt = [...words];
  misspelt[6] = "zzzz";
  assert.deepEqual(wordsProblem(misspelt), { kind: "unknown-word", position: 7, word: "zzzz" });
  // Two words swapped: the checksum catches it. A 24-word checksum is 8 bits, so about 1 random swap in 256 still adds
  // up; a fixed seed whose swap is known to break it keeps this test from failing by chance.
  const fixed = seedToWords(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255));
  const swapped = [...fixed];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.notEqual(swapped[0], swapped[1]);
  assert.deepEqual(wordsProblem(swapped), { kind: "checksum" });
  assert.equal(wordsProblem(words.map((w) => ` ${w.toUpperCase()} `)), null, "spacing and capitals don't matter");
});

test("a signature over a different hash is refused", async () => {
  const key = SoftwareKey.generate();
  const a = new Uint8Array(randomBytes(32));
  const b = new Uint8Array(randomBytes(32));
  assert.equal(signatureIsValid(b, await key.signHash(a), key.publicKey), false);
  key.destroy();
});
