// "AgentZero on this computer" (D100, D101): pairing the laptop tray with the account, end to end encrypted. Shared by
// the phone's core (it seals AgentZero's key seed to the computer) and the tray (it opens it). Pure; no network here.
//
// The flow:
//   1. The computer makes a fresh ML-KEM-768 pair and a random mailbox id, and shows at once the offer
//      "zf-pair:2:<mailbox>:<its key>" (to paste on the phone) AND 6 check words from its key alone (through scrypt).
//   2. The phone reads the offer; the core's own sheet (on the iPhone it is Face ID itself; on the web the passkey's
//      user check, D103) shows the words of the key it would seal to: the person approves only if they match the
//      computer's. Then it seals AgentZero's key seed and the account's id to that key and leaves the box in the relay's
//      one-time mailbox (ciphertext only, one read, 10 min).
//   3. The computer takes ONE box, opens it, and checks on chain that the seed's key is the account's agent_pay key.
// Why words first (security review, 3 Nov: the first design compared a 6-digit code only after the seed had arrived,
// and an attacker choosing the mailbox could grind it in ~10^6 hashes): the words are 66 bits of a slow hash (scrypt) of the
// computer's key alone, so a swapped offer needs ~2^65 memory-hard tries (the second review: keys an attacker can still
// decapsulate with are cheap to vary, so the hash must be slow), and a swapped
// mailbox alone gets a box it can't open. The tray's bearer token is derived from the computer's own secret (D101 bind 2).
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";

// ML-KEM-768 (post-quantum, like the account's own keys): an encapsulation key is 1,184 bytes (1,579 base64url
// characters), a ciphertext 1,088. X25519 was the first draft; its curve code would have joined the app's first load
// (2.5 KB), ML-KEM loads only with pairing.
const EK_BYTES = 1184;
const CT_BYTES = 1088;
const OFFER = /^zf-pair:2:([0-9a-f]{32}):([A-Za-z0-9_-]{1579})$/;
const SEAL_INFO = "zerofee-pair-seed-v2";
const VERSION = 2;

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    // Canonical only: the same bytes spell back the same text (no re-spelled copies).
    return b64u(out) === s ? out : null;
  } catch {
    return null;
  }
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** An encapsulation key ML-KEM will take (its length and its own modulus check; it throws on a bad one). */
const usable = (ek: Uint8Array) => {
  if (ek.length !== EK_BYTES) return false;
  try {
    ml_kem768.encapsulate(ek);
    return true;
  } catch {
    return false;
  }
};

export interface PairOffer {
  mailbox: string;
  computerKey: Uint8Array;
}

/** The computer's key pair from its 64-byte secret (ML-KEM keygen is deterministic from it). */
const pairFrom = (secret: Uint8Array) => {
  if (secret.length !== 64) throw new Error("the computer's secret is 64 bytes");
  return ml_kem768.keygen(secret);
};

/** The computer's side, step 1: a fresh secret (64 bytes; keep it), its key, a mailbox, and the offer text to show. */
export function makeOffer(): { offer: string; mailbox: string; secret: Uint8Array; computerKey: Uint8Array; words: string[] } {
  const secret = randomBytes(64);
  const computerKey = pairFrom(secret).publicKey;
  const mailbox = bytesToHex(randomBytes(16));
  return { offer: `zf-pair:2:${mailbox}:${b64u(computerKey)}`, mailbox, secret, computerKey, words: pairWords(computerKey) };
}

/**
 * The 6 check words for a computer's key (66 bits, BIP39's English list): shown by the computer when it starts, and on
 * the phone's sheet before anything is sealed. Through scrypt (N=2^15, r=8: ~32 MB and ~0.1 s per try) because an
 * attacker can make many ML-KEM keys it can still decapsulate with cheaply (a small change in the key's error term), so
 * each try must cost real memory and time (second security review, 3 Nov): ~2^65 such tries to match a given computer.
 */
export function pairWords(computerKey: Uint8Array): string[] {
  const h = scrypt(computerKey, utf8ToBytes("zerofee-pair-words-v2"), { N: 2 ** 15, r: 8, p: 1, dkLen: 9 });
  let bits = 0n;
  for (const byte of h) bits = (bits << 8n) | BigInt(byte);
  bits >>= 6n; // 72 → 66 bits
  return [5, 4, 3, 2, 1, 0].map((k) => wordlist[Number((bits >> BigInt(11 * k)) & 2047n)]!);
}

/** The phone's side: the offer read from the QR or pasted. Null for anything else (never a guess). */
export function readOffer(text: unknown): PairOffer | null {
  if (typeof text !== "string") return null;
  const m = OFFER.exec(text.trim());
  if (!m) return null;
  const computerKey = fromB64u(m[2]!);
  if (!computerKey || !usable(computerKey)) return null;
  return { mailbox: m[1]!, computerKey };
}

/**
 * The phone's side, step 2, only after the person saw the computer's words on the phone's own sheet and they matched:
 * AgentZero's 32-byte key seed and the account's id, sealed to the computer's key. The mailbox id and the key's hash
 * are in the AAD, so a box moved to another mailbox doesn't open.
 */
export function sealSeed(offer: PairOffer, seed: Uint8Array, accountId: string): string {
  if (seed.length !== 32) throw new Error("AgentZero's seed is 32 bytes");
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(offer.computerKey);
  const ekHash = sha256(offer.computerKey);
  const key = hkdf(sha256, sharedSecret, concat(cipherText, ekHash), utf8ToBytes(SEAL_INFO), 32);
  const nonce = randomBytes(24);
  const aad = concat(Uint8Array.of(VERSION), utf8ToBytes(offer.mailbox), ekHash);
  // The account's id rides inside the box (the tray needs it), never in the clear.
  const account = utf8ToBytes(accountId);
  if (account.length < 2 || account.length > 64) throw new Error("not a NEAR account id");
  const body = xchacha20poly1305(key, nonce, aad).encrypt(concat(Uint8Array.of(account.length), account, seed));
  return b64u(concat(Uint8Array.of(VERSION), cipherText, nonce, body));
}

/** The computer's side, step 3: AgentZero's seed and the account's id. Null if it won't open. The tray then checks ON
 *  CHAIN that the seed's key is the account's agent_pay key (it trusts nothing the box claims). */
export function openSeed(box: string, mailbox: string, secret: Uint8Array): { seed: Uint8Array; accountId: string } | null {
  const raw = fromB64u(box);
  if (!raw || raw.length < 1 + CT_BYTES + 24 + 16 + 1 || raw[0] !== VERSION) return null;
  const cipherText = raw.slice(1, 1 + CT_BYTES);
  const nonce = raw.slice(1 + CT_BYTES, 1 + CT_BYTES + 24);
  const body = raw.slice(1 + CT_BYTES + 24);
  try {
    const { publicKey: computerKey, secretKey } = pairFrom(secret);
    // ML-KEM's implicit rejection: a tampered ciphertext gives a wrong secret, and the AEAD then refuses to open.
    const shared = ml_kem768.decapsulate(cipherText, secretKey);
    const ekHash = sha256(computerKey);
    const key = hkdf(sha256, shared, concat(cipherText, ekHash), utf8ToBytes(SEAL_INFO), 32);
    const aad = concat(Uint8Array.of(VERSION), utf8ToBytes(mailbox), ekHash);
    const plain = xchacha20poly1305(key, nonce, aad).decrypt(body);
    const m = plain[0]!;
    if (m < 2 || m > 64 || plain.length !== 1 + m + 32) {
      plain.fill(0);
      return null;
    }
    const accountId = new TextDecoder().decode(plain.slice(1, 1 + m));
    const seed = plain.slice(1 + m);
    plain.fill(0);
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return null;
    return { seed, accountId };
  } catch {
    return null;
  }
}

/** The tray's bearer token for its local MCP server: derived from the computer's own private key (D101 bind 2). */
export function trayBearer(secret: Uint8Array): string {
  if (secret.length !== 64) throw new Error("the computer's secret is 64 bytes");
  return bytesToHex(hkdf(sha256, secret, utf8ToBytes("zerofee-tray"), utf8ToBytes("zerofee-tray-bearer-v1"), 32));
}
