// AgentZero's mailbox keys and sealed mail (D80, D83), in the core so it can open mail with the hot root (re-exported
// at packages/agent/src/mail/keys.ts). The receiver on zerofee.si seals each mail on arrival to the
// mailbox's public key and keeps only the sealed bytes; the phone or the laptop tray holds the secret and opens them.
// ZeroFee's server can never read a mail after it is stored. This file is shared by the phone, the tray, the receiver
// (apps/mail) and the tests, so all of them seal, open, sign and check the same way.
//
// THE DERIVATION (the phone and the tray do exactly this):
//   seed      = the hot root: BIP-39's 64-byte seed from the 24 words with ZeroFee's hot passphrase
//               (packages/core/src/hot-keys.ts, hotRoot(wordsSeed)), so a restore from the words brings the mailbox back.
//   box key   = HKDF-SHA256(ikm = seed, salt = "zerofee-mail-v1", info = "zerofee-mail-box",  32 bytes) → X25519 secret
//   sign key  = HKDF-SHA256(ikm = seed, salt = "zerofee-mail-v1", info = "zerofee-mail-sign", 32 bytes) → Ed25519 seed
// The two infos keep the keys apart from each other and from every wallet key (those come from SLIP-10/BIP-32 paths).
//
// THE SEAL (an anonymous public-key box; the receiver keeps no key of its own):
//   e        = a fresh X25519 secret per mail;  E = X25519(e)
//   shared   = X25519(e, R)  where R is the mailbox's box public key
//   key      = HKDF-SHA256(ikm = shared, salt = E ‖ R, info = "zerofee-mail-seal-v1", 32 bytes)
//   sealed   = 0x01 ‖ E (32) ‖ nonce (24, random) ‖ XChaCha20-Poly1305(key, nonce, plaintext, aad = 0x01 ‖ E ‖ R)
//   on the wire the sealed bytes are base64url (no padding).
//
// THE PROOFS (Ed25519 by the sign key; timestamps are milliseconds since 1970, as Date.now()):
//   register: sign "zerofee-mail-register:<mailbox>:<publicKey>:<timestamp>", accepted within 5 minutes either way.
//   request:  sign "zerofee-mail-<method>:<host>:<mailbox>:<id or empty>:<timestamp>", method "read" or "delete", host the
//             inbox API's configured host ("mail.zerofee.si"), sent as the header x-mail-proof: "<timestamp>.<signature>",
//             accepted within 30 seconds either way and once only (the server keeps used signatures). So a read proof
//             can't delete, a delete proof can't delete another mail, and no proof works on another server.
//   A box public key of small order (the all-zero key and its kin) is refused at registration: nothing sealed to it
//   would be secret.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";

export const MAIL_SALT = "zerofee-mail-v1";
export const SEAL_INFO = "zerofee-mail-seal-v1";
export const SEAL_VERSION = 1;
export const REGISTER_WINDOW_MS = 5 * 60 * 1000;
export const READ_WINDOW_MS = 30 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Strict base64url: no padding, no other characters, and canonical (the unused low bits of the last character are
 * zero), so one byte string has exactly one spelling. Null when it isn't.
 */
export function fromB64url(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return b64url(out) === text ? out : null;
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export interface MailKeys {
  /** X25519 secret: opens the mailbox's sealed mail. Never leaves the device. */
  boxSecret: Uint8Array;
  /** X25519 public key: the receiver seals to it. */
  boxPublic: Uint8Array;
  /** Ed25519 secret seed: signs registration and read proofs. Never leaves the device. */
  signSecret: Uint8Array;
  /** Ed25519 public key: the receiver checks proofs with it. */
  signPublic: Uint8Array;
}

/** The mailbox's two keys from the hot root (see THE DERIVATION above). */
export function mailKeys(seed: Uint8Array): MailKeys {
  if (!(seed instanceof Uint8Array) || seed.length < 32) throw new Error("the mail keys need a seed of at least 32 bytes");
  const boxSecret = hkdf(sha256, seed, enc.encode(MAIL_SALT), enc.encode("zerofee-mail-box"), 32);
  const signSecret = hkdf(sha256, seed, enc.encode(MAIL_SALT), enc.encode("zerofee-mail-sign"), 32);
  return { boxSecret, boxPublic: x25519.getPublicKey(boxSecret), signSecret, signPublic: ed25519.getPublicKey(signSecret) };
}

const sealKey = (shared: Uint8Array, eph: Uint8Array, recipient: Uint8Array) => hkdf(sha256, shared, cat(eph, recipient), enc.encode(SEAL_INFO), 32);

/** Seals bytes to a mailbox's X25519 public key. Anyone can seal; only the mailbox's secret opens. */
export function sealTo(publicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) throw new Error("a mailbox public key is 32 bytes");
  const e = x25519.utils.randomSecretKey();
  const E = x25519.getPublicKey(e);
  const key = sealKey(x25519.getSharedSecret(e, publicKey), E, publicKey);
  e.fill(0);
  const nonce = randomBytes(24);
  const head = cat(new Uint8Array([SEAL_VERSION]), E);
  const box = xchacha20poly1305(key, nonce, cat(head, publicKey)).encrypt(plaintext);
  key.fill(0);
  return cat(head, nonce, box);
}

/** Opens sealed bytes with the mailbox's X25519 secret. Throws when the key is wrong or a byte was changed. */
export function openSealed(boxSecret: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (!(sealed instanceof Uint8Array) || sealed.length < 1 + 32 + 24 + 16 || sealed[0] !== SEAL_VERSION) throw new Error("not a sealed mail");
  const E = sealed.slice(1, 33);
  const nonce = sealed.slice(33, 57);
  const R = x25519.getPublicKey(boxSecret);
  const key = sealKey(x25519.getSharedSecret(boxSecret, E), E, R);
  try {
    return xchacha20poly1305(key, nonce, cat(sealed.slice(0, 33), R)).decrypt(sealed.slice(57));
  } finally {
    key.fill(0);
  }
}

/** What a stored mail holds once opened. Nothing in it is ever an instruction to AgentZero. */
export interface Mail {
  from: string;
  subject: string;
  /** ISO 8601; the mail's own Date header, or the arrival time when it had none. */
  date: string;
  text: string;
}

/** Seals a mail as JSON, base64url: what the receiver stores and the inbox API returns as `sealed`. */
export const sealMail = (publicKey: Uint8Array, mail: Mail): string =>
  b64url(sealTo(publicKey, enc.encode(JSON.stringify({ from: mail.from, subject: mail.subject, date: mail.date, text: mail.text }))));

/** Opens a `sealed` string on the device. Throws when it can't be opened. */
export function openMail(boxSecret: Uint8Array, sealed: string): Mail {
  const bytes = fromB64url(sealed);
  if (!bytes) throw new Error("not a sealed mail");
  const m = JSON.parse(dec.decode(openSealed(boxSecret, bytes))) as Partial<Mail>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return { from: s(m.from), subject: s(m.subject), date: s(m.date), text: s(m.text) };
}

export const registerMessage = (mailbox: string, publicKey: string, timestamp: number) => `zerofee-mail-register:${mailbox}:${publicKey}:${timestamp}`;

/** What a request proof covers: the method, the API host, the mailbox and, for a delete, the mail's id. */
export interface MailRequest {
  method: "read" | "delete";
  /** The inbox API's configured host, e.g. "mail.zerofee.si" (as the server is configured). */
  host: string;
  mailbox: string;
  /** The mail's id for a delete; empty for a read. */
  id?: string;
}

export const requestMessage = (r: MailRequest, timestamp: number) => `zerofee-mail-${r.method}:${r.host}:${r.mailbox}:${r.id ?? ""}:${timestamp}`;

/** A fixed scalar for the small-order check (every clamped scalar is a multiple of the cofactor). */
const CHECK_SCALAR = sha256(enc.encode("zerofee-mail-key-check"));

/** False for an X25519 public key of small order (the all-zero key and its kin): a seal to it would not be secret. */
export function boxKeyOk(publicKey: Uint8Array | null): boolean {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) return false;
  try {
    return x25519.getSharedSecret(CHECK_SCALAR, publicKey).some((b) => b !== 0);
  } catch {
    return false;
  }
}

export interface RegisterBody {
  mailbox: string;
  /** The box public key, X25519, base64url. */
  publicKey: string;
  proof: {
    /** The sign public key, Ed25519, base64url. The receiver binds the mailbox to it on first registration. */
    signingKey: string;
    timestamp: number;
    /** Ed25519 over registerMessage(mailbox, publicKey, timestamp), base64url. */
    signature: string;
  };
}

/** The body of POST /v0/mail/register, signed now. */
export function signRegister(keys: MailKeys, mailbox: string, timestamp = Date.now()): RegisterBody {
  const publicKey = b64url(keys.boxPublic);
  const signature = b64url(ed25519.sign(enc.encode(registerMessage(mailbox, publicKey, timestamp)), keys.signSecret));
  return { mailbox, publicKey, proof: { signingKey: b64url(keys.signPublic), timestamp, signature } };
}

/** The x-mail-proof header for one request: GET /v0/mail/:mailbox (read) or DELETE /v0/mail/:mailbox/:id (delete). */
export function signRequest(keys: MailKeys, request: MailRequest, timestamp = Date.now()): string {
  return `${timestamp}.${b64url(ed25519.sign(enc.encode(requestMessage(request, timestamp)), keys.signSecret))}`;
}

const verifySig = (sig: Uint8Array | null, msg: string, key: Uint8Array | null) => {
  if (!sig || !key || sig.length !== 64 || key.length !== 32) return false;
  try {
    // RFC 8032 strict (not ZIP-215): non-canonical encodings are refused, so a signature has one byte form.
    return ed25519.verify(sig, enc.encode(msg), key, { zip215: false });
  } catch {
    return false;
  }
};

/**
 * Checks a registration's shape and proof (not the name rules, not who holds the name). Returns the decoded keys, or
 * the reason it is refused.
 */
export function verifyRegister(
  body: unknown,
  now = Date.now(),
): { ok: true; mailbox: string; publicKey: string; signingKey: string } | { ok: false; error: "bad-body" | "bad-key" | "bad-proof" | "stale" } {
  const b = body as Partial<RegisterBody> | null;
  if (!b || typeof b !== "object" || typeof b.mailbox !== "string" || typeof b.publicKey !== "string" || !b.proof || typeof b.proof !== "object") return { ok: false, error: "bad-body" };
  const { signingKey, timestamp, signature } = b.proof;
  const box = fromB64url(b.publicKey);
  const sign = fromB64url(signingKey);
  if (!box || box.length !== 32 || !sign || sign.length !== 32 || typeof signature !== "string" || typeof timestamp !== "number" || !Number.isSafeInteger(timestamp)) return { ok: false, error: "bad-body" };
  if (!boxKeyOk(box)) return { ok: false, error: "bad-key" };
  if (Math.abs(now - timestamp) > REGISTER_WINDOW_MS) return { ok: false, error: "stale" };
  if (!verifySig(fromB64url(signature), registerMessage(b.mailbox, b.publicKey, timestamp), sign)) return { ok: false, error: "bad-proof" };
  return { ok: true, mailbox: b.mailbox, publicKey: b.publicKey, signingKey: signingKey as string };
}

/**
 * Checks an x-mail-proof header for one request against the mailbox's registered sign key (base64url). Returns the
 * signature when good (the server remembers it so it works once), null otherwise.
 */
export function verifyRequest(header: unknown, request: MailRequest, signingKey: string, now = Date.now()): string | null {
  if (typeof header !== "string") return null;
  const m = /^(\d{1,16})\.([A-Za-z0-9_-]{86})$/.exec(header);
  if (!m) return null;
  const timestamp = Number(m[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > READ_WINDOW_MS) return null;
  const sig = fromB64url(m[2]);
  // The used-proof key is the signature's bytes (re-spelled canonically), never the text as sent.
  return sig && verifySig(sig, requestMessage(request, timestamp), fromB64url(signingKey)) ? b64url(sig) : null;
}
