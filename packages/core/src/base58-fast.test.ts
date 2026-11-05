// base58-fast.ts stands in for base58-js in the web build (apps/web/vite.config.ts): every answer must be the library's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base58_to_binary as libDecode, binary_to_base58 as libEncode } from "base58-js";
import { base58_to_binary, binary_to_base58 } from "./base58-fast.ts";

/** A deterministic byte stream, so a failure repeats. */
function bytes(n: number, seed: number, zeros = 0): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed * 2654435761 >>> 0;
  for (let i = zeros; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

test("encode and decode give the library's answers: every length to 80, keys of 32 and 1,952 bytes, leading zeros", () => {
  const cases: Uint8Array[] = [new Uint8Array(0), new Uint8Array(1), new Uint8Array(3), Uint8Array.of(0, 0, 1), Uint8Array.of(255)];
  for (let n = 1; n <= 80; n++) for (let z = 0; z < 3 && z < n; z++) cases.push(bytes(n, n * 7 + z, z));
  for (let s = 0; s < 6; s++) cases.push(bytes(32, 100 + s), bytes(1952, 200 + s), bytes(1953, 300 + s, s % 3));
  for (const b of cases) {
    const want = libEncode(b);
    assert.equal(binary_to_base58(b), want, `encode ${b.length} bytes`);
    if (want) assert.deepEqual(base58_to_binary(want), libDecode(want), `decode ${want.slice(0, 12)}…`);
  }
});

test("it refuses what the library refuses, and anything outside the alphabet", () => {
  for (const bad of ["", "abc0", "OI", "lll"]) {
    assert.throws(() => libDecode(bad));
    assert.throws(() => base58_to_binary(bad));
  }
  // The library turns "+" into wrong bytes; here it is refused (it can never be a key or a hash).
  assert.throws(() => base58_to_binary("ab+c"));
});
