// base58-js's two functions, with the same answers, in near-linear time (speed, 2 Nov). The web build puts this module
// in base58-js's place (apps/web/vite.config.ts), so the libraries that use it (@fastnear/ml-dsa-65, @fastnear/utils)
// get it too. base58-js converts digit by digit, which is quadratic: an ML-DSA-65 key (1,952 bytes) took a 200 ms task
// at a phone's speed each time this browser's key was built at unlock (base58 out, then in again to check its form).
// Same input checks as base58-js; base58-fast.test.ts compares every result with the library's own.
import { base58Decode, base58Encode } from "./key-handle.ts";

/** A Uint8Array (or array of bytes) as Bitcoin-alphabet base58, as base58-js's binary_to_base58 gives it. */
export function binary_to_base58(bytes: Uint8Array | ArrayLike<number>): string {
  return base58Encode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

/** The bytes of a base58 string, as base58-js's base58_to_binary gives them; throws on what it throws on. */
export function base58_to_binary(text: string): Uint8Array {
  if (!text || typeof text !== "string") throw new Error(`Expected base58 string but got “${text}”`);
  const bad = text.match(/[IOl0]/gmu);
  if (bad) throw new Error(`Invalid base58 character “${bad}”`);
  return base58Decode(text);
}
