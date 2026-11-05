// A post-quantum key's text form and short on-chain handle ("ml-dsa-65-hash:…"), fast, and worked out once per key.
//
// The usual base58 code converts digit by digit, which is quadratic in the length: for the 1,952 bytes of an ML-DSA-65
// key the library's publicKeyToHandle (decode, then re-encode to check the form) took about 40 ms a call in Node and more
// on a phone. Every account read asks for its own key's handle, so a page that read often spent whole seconds of CPU on
// it and froze (grade 1 Nov b, N1). Here base58 splits the number in halves (BigInt, native), so a key converts in well
// under a millisecond, and each key's handle is also kept: it never changes. key-handle.test.ts checks every result
// against the library's own functions.
import { sha3_256 } from "@noble/hashes/sha3.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGIT = new Map([...ALPHABET].map((c, i) => [c, i]));
const ML_DSA_65_PUBLIC_KEY_LENGTH = 1952;
const PREFIX = "ml-dsa-65:";
const HANDLE_PREFIX = "ml-dsa-65-hash:";
const DOMAIN = new TextEncoder().encode("near:ml-dsa-65-pubkey-hash:v1");
/** Digits converted with plain numbers: 58^8 < 2^53. */
const SMALL = 8;

const powers = new Map<number, bigint>();
function pow58(n: number): bigint {
  let p = powers.get(n);
  if (p === undefined) {
    p = 58n ** BigInt(n);
    powers.set(n, p);
  }
  return p;
}

/** `n` as exactly `width` base58 digits (leading "1"s are zero digits). */
function digits(n: bigint, width: number): string {
  if (width <= SMALL) {
    let v = Number(n);
    let s = "";
    for (let i = 0; i < width; i++) {
      s = ALPHABET[v % 58] + s;
      v = Math.floor(v / 58);
    }
    return s;
  }
  const low = width >> 1;
  const p = pow58(low);
  return digits(n / p, width - low) + digits(n % p, low);
}

function valueOf(s: string, from: number, to: number): bigint {
  if (to - from <= SMALL) {
    let v = 0;
    for (let i = from; i < to; i++) {
      const d = DIGIT.get(s[i]);
      if (d === undefined) throw new Error(`not base58: "${s[i]}"`);
      v = v * 58 + d;
    }
    return BigInt(v);
  }
  const mid = (from + to) >> 1;
  return valueOf(s, from, mid) * pow58(to - mid) + valueOf(s, mid, to);
}

/** Bitcoin-alphabet base58, as @fastnear/utils' toBase58 and base58-js give it. */
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  if (zeros === bytes.length) return "1".repeat(zeros);
  let hex = "";
  for (let i = zeros; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  const n = BigInt(`0x${hex}`);
  // log(256)/log(58) = 1.3657...: enough digits for the number, the extra leading zero digits cut below.
  const width = Math.ceil((bytes.length - zeros) * 1.3658) + 1;
  const out = digits(n, width);
  let lead = 0;
  while (lead < out.length - 1 && out[lead] === "1") lead++;
  return "1".repeat(zeros) + out.slice(lead);
}

/** The inverse of base58Encode. Throws on a character outside the alphabet. */
export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  if (zeros === text.length) return new Uint8Array(zeros);
  const n = valueOf(text, zeros, text.length);
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const out = new Uint8Array(zeros + hex.length / 2);
  for (let i = 0; i < hex.length / 2; i++) out[zeros + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A key's 1,952 bytes, from "ml-dsa-65:<base58>" (throws, like the library's decodePublicKey, unless well-formed). */
export function mlDsaPublicKeyBytes(publicKey: string): Uint8Array {
  if (typeof publicKey !== "string" || !publicKey.startsWith(PREFIX)) throw new Error(`ML-DSA-65 public key must start with "${PREFIX}"`);
  const encoded = publicKey.slice(PREFIX.length);
  if (!encoded) throw new Error("ML-DSA-65 public key has an empty base58 payload");
  const bytes = base58Decode(encoded);
  if (bytes.length !== ML_DSA_65_PUBLIC_KEY_LENGTH) throw new Error(`ML-DSA-65 public key must be exactly ${ML_DSA_65_PUBLIC_KEY_LENGTH} bytes; received ${bytes.length}`);
  if (base58Encode(bytes) !== encoded) throw new Error("ML-DSA-65 public key is not in canonical base58 form");
  return bytes;
}

const KEEP = 256;
const handles = new Map<string, string>();
let worked = 0;

/** The handle of a "ml-dsa-65:<base58>" public key, as the library's publicKeyToHandle gives it. Kept per key. */
export function mlDsaKeyHandle(publicKey: string): string {
  const kept = handles.get(publicKey);
  if (kept !== undefined) return kept;
  const digest = sha3_256.create().update(DOMAIN).update(mlDsaPublicKeyBytes(publicKey)).digest();
  const handle = HANDLE_PREFIX + base58Encode(digest);
  worked++;
  if (handles.size >= KEEP) handles.delete(handles.keys().next().value!);
  handles.set(publicKey, handle);
  return handle;
}

/** How NEAR lists a key: post-quantum keys by their "ml-dsa-65-hash:…" handle, classical keys as themselves. */
export function keyHandle(publicKey: string): string {
  return publicKey.startsWith(PREFIX) ? mlDsaKeyHandle(publicKey) : publicKey;
}

/** For tests: how many handles were worked out (not taken from the kept ones) so far. */
export function handlesWorkedOut(): number {
  return worked;
}
