// ZeroFee Chat's Nostr side (D55: works with BitChat's location channels). Pure: no network, no storage.
//
// The core holds the key and signs; the Chat app only ever gets public keys and signed events back (nostr.publicKey,
// nostr.sign: demo-core.ts). Nothing here exports a secret.
//
// Keys, the way BitChat makes them (bitchat/Nostr/NostrIdentityBridge.swift, deriveIdentity(forGeohash:), public
// domain): one Nostr key per place, HMAC-SHA256(seed, utf8(geohash) ‖ u32be(i)) for the first i that is a valid
// secp256k1 key (sha256(seed ‖ geohash) as a last resort), so two places can't be linked to one person. BitChat's seed
// is a random device secret; ours comes from the backup words (CHAT_PATH under the hot root, hot-keys.ts), so a phone
// restored from the words has the same names in the same places.
//
// Events: NIP-01 (id = sha256 of the canonical JSON array), BIP-340 Schnorr signatures, and BitChat's kind-20000
// geohash message: tags ["g", geohash], ["n", nickname]?, ["t", "teleport"]?, then a NIP-13 nonce tag mined to 8 bits
// for at most 2 seconds, stepping the committed target down when the time runs out (bitchat/Nostr/NostrPoW.swift).
// Presence (kind 20001) is ["g", geohash] alone with empty content.
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bip32Secp256k1 } from "./hot-keys.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { readable } from "./signer.ts";

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** BitChat's location-channel message and presence kinds (NostrProtocol.swift EventKind). */
export const GEOHASH_MESSAGE = 20000;
export const GEOHASH_PRESENCE = 20001;
/** BitChat's mined difficulty (NostrPoW.targetBits). BitChat mines for up to 2 s (miningTimeCap); the core mines on its
 *  one thread, which also answers Wallet's calls, so it is bounded far tighter (security review 2 Nov, Low): 8 bits is
 *  about 256 hashes, a few milliseconds, so 250 ms at the target (then 25 ms a step down, 4 steps from 8 bits) only
 *  bites on a pathological message, and at worst the core is busy 350 ms. */
export const POW_TARGET_BITS = 8;
export const POW_TIME_CAP_MS = 250;
export const POW_FALLBACK_MS = 25;
/** The Chat seed's place under the hot root: NIP-06's coin type (1237), its own account (16), never a wallet's. */
export const CHAT_PATH = "m/44'/1237'/16'/0/0";
const CHAT_STEPS = [{ index: 44, hardened: true }, { index: 1237, hardened: true }, { index: 16, hardened: true }, { index: 0, hardened: false }, { index: 0, hardened: false }];

/** What the core signs, and nothing longer: BitChat's own limits (TransportConfig: 1,024 bytes a tag value). */
export const MAX_CONTENT = 2000;
export const MAX_NICKNAME = 32;
const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/;
/** Control characters, direction marks and invisible joiners: never in a nickname the core signs (signer.ts readable). */
// (signer.ts readable() blanks exactly those, so a nickname it would change is refused.)

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const utf8 = (s: string) => new TextEncoder().encode(s);
const u32be = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const cat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

export const isGeohash = (g: unknown): g is string => typeof g === "string" && GEOHASH.test(g);

/** The Chat seed (32 bytes) from the hot root. It signs nothing itself: each place's key comes from it. */
export function chatSeed(hotRoot: Uint8Array): Uint8Array {
  return bip32Secp256k1(hotRoot, CHAT_STEPS);
}

const validKey = (k: Uint8Array) => {
  const n = BigInt(`0x${hex(k)}`);
  return n > 0n && n < secp256k1.Point.CURVE().n;
};

/** The secret key for one place (BitChat's deriveIdentity(forGeohash:)). */
export function placeKey(seed: Uint8Array, geohash: string): Uint8Array {
  const msg = utf8(geohash);
  for (let i = 0; i < 10; i++) {
    const k = hmac(sha256, seed, cat(msg, u32be(i)));
    if (validKey(k)) return k;
  }
  const k = sha256(cat(seed, msg));
  if (!validKey(k)) throw new Error("no key for this place");
  return k;
}

/** A key's x-only public key, as Nostr writes it (64 lower-case hex). */
export const publicKeyHex = (secret: Uint8Array): string => hex(schnorr.getPublicKey(secret));

/** NIP-01's canonical form: [0, pubkey, created_at, kind, tags, content] as JSON with no spaces (JSON.stringify's escapes). */
export function serialize(e: Pick<NostrEvent, "pubkey" | "created_at" | "kind" | "tags" | "content">): string {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}

export const eventHash = (e: Pick<NostrEvent, "pubkey" | "created_at" | "kind" | "tags" | "content">): Uint8Array => sha256(utf8(serialize(e)));

/** NIP-13: leading zero bits of an id. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let total = 0;
  for (const b of bytes) {
    if (b === 0) {
      total += 8;
      continue;
    }
    return total + Math.clz32(b) - 24;
  }
  return total;
}

/** BitChat's scoring (NostrPoW.validatedDifficulty): the committed target counts only if the id meets it. */
export function validatedDifficulty(idHex: string, tags: string[][]): number {
  const nonce = [...tags].reverse().find((t) => t[0] === "nonce");
  if (!nonce || nonce.length < 3 || !/^\d+$/.test(nonce[2]!)) return 0;
  const committed = Number(nonce[2]);
  if (committed <= 0 || committed > 256 || !/^[0-9a-f]{64}$/i.test(idHex)) return 0;
  return leadingZeroBits(fromHex(idHex)) >= committed ? committed : 0;
}

/**
 * A NIP-13 nonce tag ["nonce", <16 hex>, <target>] for these fields, mined like BitChat's: at most `capMs` at the
 * target, then the target halves (POW_FALLBACK_MS each) until one is met, so the message always goes with an honest claim.
 */
export function mineNonce(
  fields: Pick<NostrEvent, "pubkey" | "created_at" | "kind" | "tags" | "content">,
  options: { targetBits?: number; capMs?: number; now?: () => number; start?: bigint } = {},
): string[] {
  const now = options.now ?? Date.now;
  let target = Math.min(Math.max(options.targetBits ?? POW_TARGET_BITS, 0), 256);
  let budget = options.capMs ?? POW_TIME_CAP_MS;
  let nonce = options.start ?? BigInt(`0x${hex(globalThis.crypto.getRandomValues(new Uint8Array(8)))}`);
  for (;;) {
    const deadline = now() + budget;
    for (let tries = 0; ; tries++) {
      const value = (nonce & 0xffffffffffffffffn).toString(16).padStart(16, "0");
      const tag = ["nonce", value, String(target)];
      if (leadingZeroBits(eventHash({ ...fields, tags: [...fields.tags, tag] })) >= target) return tag;
      nonce += 1n;
      if (tries % 64 === 63 && now() >= deadline) break;
    }
    if (target === 0) return ["nonce", "0".repeat(16), "0"];
    target = Math.floor(target / 2);
    budget = POW_FALLBACK_MS;
  }
}

/** Signs the fields with `secret` (BIP-340, fresh auxiliary randomness). */
export function signEvent(secret: Uint8Array, fields: Pick<NostrEvent, "created_at" | "kind" | "tags" | "content">): NostrEvent {
  const unsigned = { pubkey: publicKeyHex(secret), ...fields };
  const hash = eventHash(unsigned);
  const sig = schnorr.sign(hash, secret, globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return { id: hex(hash), ...unsigned, sig: hex(sig) };
}

const HEX64 = /^[0-9a-f]{64}$/;
/** A relay's event as BitChat accepts one: well-formed, at most 64 tags of at most 16 values of at most 1,024 bytes,
 *  its id the hash of its fields and its signature valid for its pubkey. Never throws. */
export function verifyEvent(e: unknown): e is NostrEvent {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  if (typeof x.id !== "string" || !HEX64.test(x.id) || typeof x.pubkey !== "string" || !HEX64.test(x.pubkey)) return false;
  if (typeof x.sig !== "string" || !/^[0-9a-f]{128}$/.test(x.sig) || typeof x.content !== "string") return false;
  if (!Number.isSafeInteger(x.created_at) || !Number.isSafeInteger(x.kind) || !Array.isArray(x.tags) || x.tags.length > 64) return false;
  for (const t of x.tags as unknown[]) {
    if (!Array.isArray(t) || t.length > 16 || !t.every((v) => typeof v === "string" && utf8(v).length <= 1024)) return false;
  }
  try {
    const hash = eventHash(x as unknown as NostrEvent);
    return hex(hash) === x.id && schnorr.verify(fromHex(x.sig), hash, fromHex(x.pubkey));
  } catch {
    return false;
  }
}

/** What an app may ask the core to sign: a place's message or presence, built here from these fields alone. */
export interface ChatSignRequest {
  geohash: string;
  kind: typeof GEOHASH_MESSAGE | typeof GEOHASH_PRESENCE;
  content: string;
  nickname?: string;
  teleport?: boolean;
}

const refuse = (why: string): never => {
  throw new ProblemError(securityProblems.requestInvalid(why));
};

/** Checks an app's request and returns the event's unsigned fields (tags built here, never taken from the app). */
export function chatFields(p: Record<string, unknown>, nowSeconds: number): { geohash: string; fields: Pick<NostrEvent, "created_at" | "kind" | "tags" | "content"> } {
  if (!isGeohash(p.geohash)) refuse("a place is 2 to 12 geohash letters");
  const geohash = p.geohash as string;
  const created_at = Math.floor(nowSeconds);
  if (p.kind === GEOHASH_PRESENCE) {
    if (p.content !== "" && p.content !== undefined) refuse("presence has no text");
    return { geohash, fields: { created_at, kind: GEOHASH_PRESENCE, tags: [["g", geohash]], content: "" } };
  }
  if (p.kind !== GEOHASH_MESSAGE) refuse("only a place's messages and presence are signed");
  if (typeof p.content !== "string" || !p.content.trim() || p.content.length > MAX_CONTENT) refuse(`a message is 1 to ${MAX_CONTENT} characters`);
  const tags: string[][] = [["g", geohash]];
  if (p.nickname !== undefined) {
    const nick = p.nickname;
    if (typeof nick !== "string" || !nick.trim() || nick.length > MAX_NICKNAME || readable(nick) !== nick) refuse(`a nickname is 1 to ${MAX_NICKNAME} plain characters`);
    tags.push(["n", (nick as string).trim()]);
  }
  if (p.teleport === true) tags.push(["t", "teleport"]);
  else if (p.teleport !== undefined && p.teleport !== false) refuse("teleport is true or false");
  return { geohash, fields: { created_at, kind: GEOHASH_MESSAGE, tags, content: p.content as string } };
}

/** The whole signing step the core runs for nostr.sign: checked fields, mined nonce (messages only), signature. */
export function signChat(seed: Uint8Array, p: Record<string, unknown>, options: { nowSeconds?: number; mine?: Parameters<typeof mineNonce>[1] } = {}): NostrEvent {
  if (!isGeohash(p.geohash)) refuse("a place is 2 to 12 geohash letters");
  return signChatWith(placeKey(seed, p.geohash as string), p, options);
}

/** The same step with a given place key (a named key in a place: chat-near.ts namedPlaceKey). Wipes `secret`. */
export function signChatWith(secret: Uint8Array, p: Record<string, unknown>, options: { nowSeconds?: number; mine?: Parameters<typeof mineNonce>[1] } = {}): NostrEvent {
  try {
    const { fields } = chatFields(p, options.nowSeconds ?? Date.now() / 1000);
    if (fields.kind !== GEOHASH_MESSAGE) return signEvent(secret, fields);
    const nonce = mineNonce({ pubkey: publicKeyHex(secret), ...fields }, options.mine);
    return signEvent(secret, { ...fields, tags: [...fields.tags, nonce] });
  } finally {
    secret.fill(0);
  }
}
