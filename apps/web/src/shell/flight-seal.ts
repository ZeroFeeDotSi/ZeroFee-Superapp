// The test flight recorder (product decision, 4 Nov): the seal on each batch, shared by the app (flight.ts seals) and the reader
// (tools/trace.ts opens). End to end: the relay only ever holds ciphertext. The pattern is packages/core/src/pair.ts
// sealSeed's, with X25519 (32 bytes a batch, and the batches seal once a second): a fresh ephemeral key per batch, the
// shared secret through HKDF-SHA256 (salt: both public keys), then XChaCha20-Poly1305 with the trace id in the AAD, so a
// batch moved to another trace doesn't open. Pure; no network here.
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const VERSION = 1;
const INFO = "zerofee-flight-v1";
/** A trace id: 32 lowercase hex (the relay's own rule too, apps/quotes/trace.mjs). */
export const TRACE_ID = /^[0-9a-f]{32}$/;

export const b64u = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export function fromB64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return b64u(out) === s ? out : null;
  } catch {
    return null;
  }
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
const keyOf = (shared: Uint8Array, eph: Uint8Array, reader: Uint8Array) => hkdf(sha256, shared, concat(eph, reader), utf8ToBytes(INFO), 32);
const aadOf = (id: string) => concat(Uint8Array.of(VERSION), utf8ToBytes(id));

/** The reader's key pair (tools/trace.sh init): its secret never leaves $ZEROFEE_HOME/trace-key. */
export function readerKeys(): { secret: Uint8Array; publicKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicKey: b64u(x25519.getPublicKey(secret)) };
}

/** The reader's public key from the build (base64url, 32 bytes), or null when it isn't one. */
export function readerKey(raw: unknown): Uint8Array | null {
  const k = typeof raw === "string" ? fromB64u(raw.trim()) : null;
  return k && k.length === 32 ? k : null;
}

/** One batch's text, sealed to the reader's key: base64url of version ‖ ephemeral key ‖ nonce ‖ ciphertext. */
export function sealBatch(plain: string, reader: Uint8Array, id: string): string {
  if (!TRACE_ID.test(id)) throw new Error("not a trace id");
  const e = x25519.utils.randomSecretKey();
  const E = x25519.getPublicKey(e);
  const key = keyOf(x25519.getSharedSecret(e, reader), E, reader);
  e.fill(0);
  const nonce = randomBytes(24);
  const body = xchacha20poly1305(key, nonce, aadOf(id)).encrypt(utf8ToBytes(plain));
  key.fill(0);
  return b64u(concat(Uint8Array.of(VERSION), E, nonce, body));
}

/** The reader's side: the batch's text, or null when it won't open (another key, another trace, tampered). */
export function openBatch(box: string, secret: Uint8Array, id: string): string | null {
  const raw = fromB64u(box);
  if (!raw || raw.length < 1 + 32 + 24 + 16 || raw[0] !== VERSION) return null;
  try {
    const E = raw.slice(1, 33);
    const nonce = raw.slice(33, 57);
    const key = keyOf(x25519.getSharedSecret(secret, E), E, x25519.getPublicKey(secret));
    const plain = xchacha20poly1305(key, nonce, aadOf(id)).decrypt(raw.slice(57));
    key.fill(0);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
