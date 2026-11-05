// The trading wallet's secret at rest, sealed under the person's passcode. A copied browser profile can only be attacked
// offline, one guess at a time, so each guess is made slow and memory-hungry (scrypt); AES-256-GCM then seals the secret
// and refuses any changed byte. The parameters travel with the sealed blob, so they can be raised later without a move.
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { base64, fromBase64 } from "@zerofee/trade/sol/bytes.ts";

export interface KdfParams { N: number; r: number; p: number }
/** About a second and 128 MiB per guess on a laptop. */
export const KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };
export const MIN_PASSCODE = 10;

export interface Sealed { v: 1; kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; ct: string }

/** What each sealed blob is for, bound into the seal, so a blob made for one use can't be opened as another. */
export const PURPOSE = { vault: "zerofee-extension/vault/v1", link: "zerofee-extension/link/v1", touch: "zerofee-extension/touch/v1" } as const;
const aad = (purpose: string) => new TextEncoder().encode(purpose);
/** WebCrypto takes bytes on a plain ArrayBuffer: a copy guarantees it. */
const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const sane = (k: KdfParams) => Number.isInteger(Math.log2(k.N)) && k.N >= 2 ** 10 && k.N <= 2 ** 20 && k.r >= 1 && k.r <= 16 && k.p >= 1 && k.p <= 4;

async function keyFrom(passcode: string, salt: Uint8Array, k: KdfParams): Promise<CryptoKey> {
  const raw = await scryptAsync(new TextEncoder().encode(passcode.normalize("NFKC")), salt, { N: k.N, r: k.r, p: k.p, dkLen: 32 });
  const copy = own(raw);
  try { return await crypto.subtle.importKey("raw", copy, "AES-GCM", false, ["encrypt", "decrypt"]); } finally { raw.fill(0); copy.fill(0); }
}

export async function seal(secret: Uint8Array, passcode: string, k: KdfParams = KDF, purpose: string = PURPOSE.vault): Promise<Sealed> {
  if (!sane(k)) throw new Error("scrypt parameters out of range");
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passcode, salt, k);
  const plain = own(secret);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(purpose) }, key, plain).finally(() => plain.fill(0)));
  return { v: 1, kdf: "scrypt", N: k.N, r: k.r, p: k.p, salt: base64(salt), iv: base64(iv), ct: base64(ct) };
}

/** The secret, or null when the passcode is wrong or the blob isn't one this build sealed. */
export async function unseal(s: Sealed, passcode: string, purpose: string = PURPOSE.vault): Promise<Uint8Array | null> {
  if (s?.v !== 1 || s.kdf !== "scrypt" || !sane(s)) return null;
  const key = await keyFrom(passcode, fromBase64(s.salt), s);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: own(fromBase64(s.iv)), additionalData: aad(purpose) }, key, own(fromBase64(s.ct))));
  } catch {
    return null;
  }
}

/**
 * The second way into the same secret, beside the passcode's (Security's ruling, 26 Oct): Touch ID's WebAuthn PRF output
 * (hmac-secret, the platform authenticator, user verification) and the random salt kept next to it, through HKDF-SHA256,
 * as an AES-256-GCM key. Only the credential's id, the salt and the sealed bytes are stored; the PRF output stays in
 * memory. The salt is also what the authenticator is asked to evaluate, so the same credential gives the same key.
 */
export interface TouchSealed { v: 1; credId: string; salt: string; iv: string; ct: string }
export const PRF_BYTES = 32;

async function touchKey(prf: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  if (prf.length !== PRF_BYTES || salt.length !== PRF_BYTES) throw new Error("a PRF output and its salt are 32 bytes each");
  const ikm = own(prf);
  try {
    const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: own(salt), info: aad(PURPOSE.touch) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally { ikm.fill(0); }
}

export async function sealTouch(secret: Uint8Array, prf: Uint8Array, salt: Uint8Array, credId: string): Promise<TouchSealed> {
  const key = await touchKey(prf, salt), iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = own(secret);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(PURPOSE.touch) }, key, plain).finally(() => plain.fill(0)));
  return { v: 1, credId, salt: base64(salt), iv: base64(iv), ct: base64(ct) };
}

/** The secret, or null when this PRF output doesn't open it (another authenticator, or it was reset). */
export async function unsealTouch(t: TouchSealed, prf: Uint8Array): Promise<Uint8Array | null> {
  if (t?.v !== 1) return null;
  try {
    const key = await touchKey(prf, fromBase64(t.salt));
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: own(fromBase64(t.iv)), additionalData: aad(PURPOSE.touch) }, key, own(fromBase64(t.ct))));
  } catch {
    return null;
  }
}
