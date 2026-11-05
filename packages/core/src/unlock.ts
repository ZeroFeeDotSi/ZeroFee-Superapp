// The web vault's unlock (audit K-1): every browser vault on this device is encrypted with keys that come from one
// random 32-byte root, and the root is kept only sealed with the person's own secret:
//
//   - a passkey with the WebAuthn PRF extension (Touch ID, Face ID, Windows Hello): the authenticator's PRF output for a
//     salt kept here, through HKDF, is the key that seals the root;
//   - where a browser or authenticator has no PRF, a passcode: Argon2id (64 MiB, 3 passes) over it. A passcode is
//     weaker than a passkey (a copied profile can be guessed at offline), so it must be at least 8 characters and not
//     an obvious one, and wrong tries on this device wait longer each time (passcodeWaitMs).
//
// The sealed root sits in its own IndexedDB store ("zerofee-unlock"). Opened, it lives in memory only, as a
// non-extractable HKDF key (UnlockSession), and each vault's AES-GCM key is derived from it by the vault's name. Nothing
// at rest decrypts without the person: copying the browser profile gets ciphertext and a salt. Locking (idle, the tab
// hidden, or by hand) drops the root; the page then reloads, so every key the page had derived is gone with it.
//
// On the phone none of this runs: the core's vault is the Keychain and its key the Secure Enclave (apps/ios).
import { argon2idAsync } from "@noble/hashes/argon2.js";

export type UnlockMethod = "passkey" | "passcode";

/**
 * Argon2id's settings for a new passcode (re-audit K2-1: m >= 64 MiB, t >= 3). Stored with each record, so a later
 * change never strands an old one: a record sealed with weaker settings still opens, and is sealed again with these.
 */
export const PASSCODE_KDF = { name: "argon2id", t: 3, m: 65_536, p: 1 } as const;
/** The weakest settings a record may still be opened with (the first release's), before it is sealed again. */
const PASSCODE_KDF_OPEN_FLOOR = { t: 2, m: 19_456 } as const;
/** The shortest passcode taken. */
export const PASSCODE_MIN = 8;
/** The web wallet's password (review, QA, 4 Nov): it alone guards the words and keys, so 12 at least. */
export const WEB_PASSWORD_MIN = 12;
/** No touch, click or key for this long: the vault locks. */
export const IDLE_LOCK_MS = 15 * 60_000;
/** The tab out of sight for this long: the vault locks. */
export const HIDDEN_LOCK_MS = 5 * 60_000;

interface Sealed {
  v: 1;
  iv: Uint8Array;
  sealed: Uint8Array;
}
export interface PasskeyRecord extends Sealed {
  method: "passkey";
  /** The passkey's raw credential id, so unlocking asks for this one only. */
  credentialId: Uint8Array;
  /** The PRF salt the authenticator is asked to evaluate. */
  prfSalt: Uint8Array;
}
export interface PasscodeRecord extends Sealed {
  method: "passcode";
  kdf: { name: "argon2id"; t: number; m: number; p: number; salt: Uint8Array };
  /** Wrong tries since the last right one, and when the next try may be made (ms): see passcodeWaitMs. */
  failed?: number;
  waitUntil?: number;
}
export type UnlockRecord = PasskeyRecord | PasscodeRecord;

/** A vault was asked while nothing is unlocked. */
export class VaultLockedError extends Error {
  constructor() {
    super("ZeroFee is locked on this device");
    this.name = "VaultLockedError";
  }
}
/** The passcode or passkey given doesn't open this record. */
export class WrongSecretError extends Error {
  constructor() {
    super("that doesn't open it");
    this.name = "WrongSecretError";
  }
}

const enc = new TextEncoder();
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const ad = (method: UnlockMethod) => enc.encode(`zerofee/unlock/v1/${method}`);

async function hkdfKey(secret: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The key that seals the root, from a passkey's PRF output (32 bytes). */
const kekFromPrf = (prf: Uint8Array) => hkdfKey(prf, "zerofee/unlock/v1/passkey");

/** The key that seals the root, from a passcode (Argon2id, then HKDF). The stretched bytes are zeroed after. */
async function kekFromPasscode(passcode: string, kdf: PasscodeRecord["kdf"]): Promise<CryptoKey> {
  if (kdf.name !== "argon2id" || kdf.m < PASSCODE_KDF_OPEN_FLOOR.m || kdf.t < PASSCODE_KDF_OPEN_FLOOR.t) throw new Error("this passcode record's settings are below the floor");
  const stretched = await argon2idAsync(enc.encode(passcode.normalize("NFKC")), kdf.salt, { t: kdf.t, m: kdf.m, p: kdf.p, dkLen: 32 });
  try {
    return await hkdfKey(stretched, "zerofee/unlock/v1/passcode");
  } finally {
    stretched.fill(0);
  }
}

/** Is this passcode one ZeroFee takes? Null when it is; otherwise the plain words for why not. */
export function passcodeRefusal(passcode: string): string | null {
  const chars = [...passcode.normalize("NFKC").toLowerCase()];
  if (chars.length < PASSCODE_MIN) return `Use at least ${PASSCODE_MIN} characters. Four words work well.`;
  const plain = chars.join("");
  if (/^[0-9\s]+$/.test(plain)) return "Not only numbers: add letters, or use four words.";
  const codes = chars.map((c) => c.codePointAt(0)!);
  const step = codes[1]! - codes[0]!;
  if (Math.abs(step) <= 1 && codes.every((c, i) => i === 0 || c - codes[i - 1]! === step)) return "Anyone could guess that one (a run or a repeat). Try four words.";
  // A short piece said again and again ("abababab", "abcabcab").
  for (let n = 1; n <= chars.length / 2; n++) if (chars.every((c, i) => c === chars[i % n])) return "Anyone could guess that one (a run or a repeat). Try four words.";
  if (COMMON.has(plain.replace(/\s+/g, ""))) return "That one is on every list of guesses. Try four words.";
  return null;
}
/**
 * The web wallet's password: 12 characters at least, never numbers only, a run or a repeat, and never a guess off the
 * lists, even with digits or signs added around it or letters swapped for look-alikes ("P@ssw0rd2024!", "qwerty123456").
 * Null when it is taken; otherwise the plain words for why not.
 */
export function passwordRefusal(password: string): string | null {
  const chars = [...password.normalize("NFKC").toLowerCase()];
  if (chars.length < WEB_PASSWORD_MIN) return `Use at least ${WEB_PASSWORD_MIN} characters.`;
  const plain = chars.join("");
  if (/^[0-9\s]+$/.test(plain)) return "Add letters too. Numbers alone are quick to guess.";
  if (passcodeRefusal(password)) return GUESSED;
  // look-alikes back to letters, then only the letters: what a guesser's list tries
  const letters = plain.replace(/[0@4]/g, (c) => (c === "0" ? "o" : "a")).replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[5$]/g, "s").replace(/7/g, "t").replace(/[^a-z]/g, "");
  if (letters.length < 4) return FEW_LETTERS;
  if (GUESS_BASES.some((b) => letters === b || (letters.length <= b.length + 4 && letters.includes(b)))) return GUESSED;
  // one guess said again and again ("dragondragon", "abcabcabcabc")
  for (let n = 1; n <= letters.length / 2; n++) if ([...letters].every((c, i) => c === letters[i % n])) return GUESSED;
  return null;
}
const GUESSED = "That one is quick to guess. Try four words.";
/** Fewer than 4 letters is refused even when nobody would guess it ("92869268x#q2"), so it gets its own line. */
const FEW_LETTERS = "Use at least 4 letters.";
/** The words guessers try first, as letters only (passwordRefusal folds digits, signs and look-alikes away first). */
const GUESS_BASES = ["password", "passwort", "passw", "qwerty", "qwertz", "azerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm", "iloveyou", "letmein", "welcome", "admin", "administrator", "monkey", "dragon", "master", "shadow", "sunshine", "princess", "football", "baseball", "soccer", "superman", "batman", "trustno", "zerofee", "bitcoin", "ethereum", "solana", "crypto", "wallet", "phantom", "metamask", "secret", "changeme", "default", "login", "hello", "freedom", "whatever", "starwars", "pokemon", "abc", "abcdef", "abcdefgh", "test", "testing", "guest", "user", "root", "love", "lovely", "computer", "internet", "google", "michael", "jordan", "jennifer", "charlie", "thomas", "summer", "winter", "spring", "autumn", "january", "december", "pass", "mypassword", "yourpassword"];

/** Passcodes every guesser tries first (8 characters or more). */
const COMMON = new Set(["password", "passw0rd", "password1", "qwertyuiop", "qwertyui", "iloveyou", "sunshine", "princess", "football", "baseball", "superman", "trustno1", "zerofee1", "zerofee123", "letmein1", "welcome1", "admin123", "abc12345", "qwerty123", "1q2w3e4r", "q1w2e3r4", "asdfghjk", "zxcvbnm1"]);

/**
 * Wrong passcodes on this device wait longer each time (re-audit K2-3), counted in the record: none for the first
 * two, then 30 s, 1 min, 5 min, 15 min, and an hour from the seventh on. This slows guessing on the device itself;
 * a copied profile is guessed offline, which is what Argon2id and the passcode rules are for.
 */
const WAITS_MS = [0, 0, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export function passcodeWaitMs(record: UnlockRecord, now: number): number {
  return record.method === "passcode" && record.waitUntil ? Math.max(0, record.waitUntil - now) : 0;
}
/** The record after one more wrong try. */
export function afterWrongPasscode(record: PasscodeRecord, now: number): PasscodeRecord {
  const failed = (record.failed ?? 0) + 1;
  return { ...record, failed, waitUntil: now + WAITS_MS[Math.min(failed, WAITS_MS.length) - 1]! };
}

/**
 * The open root, in memory only. A vault asks it for its own key by name; locked, it refuses (VaultLockedError).
 * `generation` changes on every open and lock, so a vault knows a key it derived earlier is no longer good.
 */
export class UnlockSession {
  private root: CryptoKey | null = null;
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  private readonly lockedHandlers = new Set<() => void>();
  generation = 0;

  get unlocked(): boolean {
    return this.root !== null;
  }

  /** Takes the root's 32 bytes, keeps them as a non-extractable key, and zeroes the bytes it was given. */
  async open(rootBytes: Uint8Array): Promise<void> {
    try {
      if (rootBytes.length !== 32) throw new Error("the root is 32 bytes");
      this.root = await crypto.subtle.importKey("raw", rootBytes as BufferSource, "HKDF", false, ["deriveKey"]);
    } finally {
      rootBytes.fill(0);
    }
    this.keys.clear();
    this.generation++;
  }

  /** A vault's own AES-GCM key, derived from the root by the vault's name (never extractable). */
  vaultKey(name: string): Promise<CryptoKey> {
    const root = this.root;
    if (!root) return Promise.reject(new VaultLockedError());
    let key = this.keys.get(name);
    if (!key) {
      key = crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`zerofee/vault/v1/${name}`) }, root, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      this.keys.set(name, key);
    }
    return key;
  }

  /** Drop the root and every key derived from it. */
  lock(): void {
    if (!this.root) return;
    this.root = null;
    this.keys.clear();
    this.generation++;
    for (const h of [...this.lockedHandlers]) h();
  }

  onLocked(handler: () => void): () => void {
    this.lockedHandlers.add(handler);
    return () => this.lockedHandlers.delete(handler);
  }
}

/** The page's one session: every BrowserVault on the page reads its keys from here. */
export const vaultSession = new UnlockSession();

async function seal(kek: CryptoKey, method: UnlockMethod, root: Uint8Array): Promise<Sealed> {
  const iv = random(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad(method) }, kek, root as BufferSource));
  return { v: 1, iv, sealed };
}

async function unseal(kek: CryptoKey, record: UnlockRecord): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv as BufferSource, additionalData: ad(record.method) }, kek, record.sealed as BufferSource));
  } catch {
    throw new WrongSecretError();
  }
}

/** A new root, sealed with a passkey's PRF output; the session is opened with it. Returns the record to keep. */
export async function setUpPasskey(session: UnlockSession, passkey: { credentialId: Uint8Array; prfSalt: Uint8Array; prf: Uint8Array }): Promise<PasskeyRecord> {
  const root = random(32);
  try {
    const record: PasskeyRecord = { method: "passkey", credentialId: passkey.credentialId.slice(), prfSalt: passkey.prfSalt.slice(), ...(await seal(await kekFromPrf(passkey.prf), "passkey", root)) };
    await session.open(root);
    return record;
  } finally {
    root.fill(0);
    passkey.prf.fill(0);
  }
}

/** A new root, sealed with a passcode; the session is opened with it. Returns the record to keep. */
export async function setUpPasscode(session: UnlockSession, passcode: string, refuse: (passcode: string) => string | null = passcodeRefusal): Promise<PasscodeRecord> {
  const refusal = refuse(passcode);
  if (refusal) throw new Error(refusal);
  const root = random(32);
  try {
    const kdf = { ...PASSCODE_KDF, salt: random(16) };
    const record: PasscodeRecord = { method: "passcode", kdf, ...(await seal(await kekFromPasscode(passcode, kdf), "passcode", root)) };
    await session.open(root);
    return record;
  } finally {
    root.fill(0);
  }
}

/**
 * Open the session with a passkey's PRF output, or a passcode. A wrong one throws WrongSecretError and opens nothing.
 * Returns the record to keep from now on when it changed (a passcode's tries cleared, or its root sealed again with
 * today's Argon2id settings), else null.
 */
export async function unlock(session: UnlockSession, record: UnlockRecord, secret: { prf: Uint8Array } | { passcode: string }): Promise<UnlockRecord | null> {
  let kek: CryptoKey;
  if (record.method === "passkey") {
    if (!("prf" in secret)) throw new WrongSecretError();
    try {
      kek = await kekFromPrf(secret.prf);
    } finally {
      secret.prf.fill(0);
    }
  } else {
    if (!("passcode" in secret)) throw new WrongSecretError();
    kek = await kekFromPasscode(secret.passcode, record.kdf);
  }
  const root = await unseal(kek, record);
  let next: UnlockRecord | null = null;
  try {
    if (record.method === "passcode" && "passcode" in secret) {
      const weaker = record.kdf.m < PASSCODE_KDF.m || record.kdf.t < PASSCODE_KDF.t;
      if (weaker) {
        const kdf = { ...PASSCODE_KDF, salt: random(16) };
        next = { method: "passcode", kdf, ...(await seal(await kekFromPasscode(secret.passcode, kdf), "passcode", root)) };
      } else if (record.failed || record.waitUntil) {
        const { failed: _f, waitUntil: _w, ...clean } = record;
        next = clean;
      }
    }
  } finally {
    await session.open(root);
  }
  return next;
}

/**
 * When to lock: no activity for IDLE_LOCK_MS, or the tab hidden for HIDDEN_LOCK_MS. Pure (the caller gives the time), so
 * it can be tested without a browser. Activity after the limit doesn't count: the lock comes first.
 */
export class IdleLock {
  private last: number;
  private hiddenAt: number | null = null;
  private readonly idleMs: number;
  private readonly hiddenMs: number;
  constructor(now: number, idleMs = IDLE_LOCK_MS, hiddenMs = HIDDEN_LOCK_MS) {
    this.last = now;
    this.idleMs = idleMs;
    this.hiddenMs = hiddenMs;
  }
  due(now: number): boolean {
    return now - this.last >= this.idleMs || (this.hiddenAt !== null && now - this.hiddenAt >= this.hiddenMs);
  }
  /** A touch, click or key. True: lock now (it came too late to count). */
  activity(now: number): boolean {
    if (this.due(now)) return true;
    this.last = now;
    return false;
  }
  hidden(now: number): void {
    this.hiddenAt ??= now;
  }
  /** Back in sight. True: lock now (it was hidden too long). */
  visible(now: number): boolean {
    if (this.due(now)) return true;
    this.hiddenAt = null;
    this.last = now;
    return false;
  }
}
