// ZeroFee Chat on NEAR (J3 part 2, "NEARchat" in docs): what NEAR carries for Chat. The transport stays Nostr (places
// are BitChat's kind-20000 events, nostr.ts); NEAR carries the person's name (their account), rooms, and money.
// Pure: no network, no storage. The core signs with it (demo-core.ts, MockBridge); Chat checks with it.
// Security review of the design (2 Nov, $ZEROFEE_HOME/screens/j3b-nearchat/security-review.md): H2, M4, M7, L2 below.
//
// 1. Rooms. A NEAR room is `near:<account>` (an account's room; a Sputnik DAO's room is its account's room) or
//    `token:<SYMBOL>`. Its messages are kind 9 (NIP-C7's chat message) with one tag, ["h", room] (NIP-29's group tag),
//    built here, never taken from the app. BitChat reads only kind 20000/20001 by #g, so it never sees them.
//    Every NEAR room is signed by one key of the person's per account, the room key: HMAC-SHA256(seed,
//    "zerofee/near-rooms/<account>" ‖ u32be(i)). In a NEAR room the person IS their account, so one key across rooms
//    links nothing new; per account, so a device that changes account never links the two (M7).
//
// 2. Named place keys. A place's own key (BitChat's, nostr.ts placeKey) is never named: "Show my NEAR name" in a place
//    uses a second key for that place, HMAC-SHA256(seed, "zerofee/named/<account>/<geohash>" ‖ u32be(i)), so turning it
//    off goes back to the anonymous key, and nothing said anonymously is ever named (H2a). "/" is never in a geohash.
//
// 3. The name. The account signs, with one of its own keys and after the core's sheet, a NEP-413 note naming one chat
//    key (the room key, or one place's named key), for at most 60 days:
//        ZeroFee Chat name
//        Account: <account>
//        Chat key: <64 hex>
//        Until: <ISO time>
//    for the recipient chat.zerofee.si, a 32-byte random nonce, no callback. The chat key then signs the record (kind
//    30078, NIP-78's app data, tags exactly [["d", "zerofee-chat-name"]]), so each half signs for the other. Nothing is
//    written on chain and no key is added to the account. A reader takes a record only while its note is in date, the
//    record itself was signed in the last 30 days (the core signs it again whenever Chat opens), and the note's key is
//    still one of the account's own device keys (Chat asks NEAR: chat-reads.ts). A record with empty content takes a name
//    back; one held back by a relay counts for 30 days at most (H2c).
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { verifyHash } from "@fastnear/ml-dsa-65";
import { base58Decode } from "./key-handle.ts";
import { nep413Hash } from "./private-pocket.ts";
import { MAX_CONTENT, isGeohash, placeKey, signEvent, type NostrEvent } from "./nostr.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

/** NIP-C7's chat message: a NEAR room's messages. */
export const ROOM_MESSAGE = 9;
/** NIP-78's app data (parameterised replaceable): the name record. */
export const CHAT_NAME_KIND = 30078;
export const CHAT_NAME_D = "zerofee-chat-name";
/** NEP-413's recipient for the name note: no other verifier takes a note for it. */
export const CHAT_NAME_RECIPIENT = "chat.zerofee.si";
export const CHAT_NAME_FIRST_LINE = "ZeroFee Chat name";
/** How long a note lasts (H2b: at most 90 days; renewed on a sheet). */
export const NAME_DAYS = 60;
const DAY_MS = 86_400_000;
/** How old a record (the chat key's signature on it) may be before a reader stops taking it (H2c). */
export const RECORD_MAX_AGE_SECONDS = 30 * 86_400;
const AHEAD_SECONDS = 900;
/** A place where a NEAR name may be shown: a city or wider (geohash of 5 letters or fewer, M7). */
export const NAMED_PLACE_MAX = 5;
/** Caps on what a record may hold (an ML-DSA-65 key is ~2,670 base58 characters, its signature ~4,500). */
const MAX_KEY_TEXT = 3000;
const MAX_SIG_TEXT = 5000;

/** NEAR's account id rule (2 to 64 characters, lower-case letters, digits, "-", "_" and "." between parts). */
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isAccountId = (s: unknown): s is string => typeof s === "string" && ACCOUNT_ID.test(s);
const TOKEN = /^[A-Z0-9]{2,10}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** A room's id, as the core signs it: `near:<account>` or `token:<SYMBOL>`. */
export function isRoomId(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s.startsWith("near:")) return isAccountId(s.slice(5));
  if (s.startsWith("token:")) return TOKEN.test(s.slice(6));
  return false;
}

/** What a person typed in "Open a room", as a room: a NEAR account name (with a dot) or a coin's symbol. Null: neither. */
export function roomFor(typed: string): string | null {
  const t = typed.trim();
  const lower = t.toLowerCase().replace(/^@/, "");
  if (lower.includes(".")) return isAccountId(lower) ? `near:${lower}` : null;
  const up = t.toUpperCase().replace(/^\$/, "");
  return TOKEN.test(up) ? `token:${up}` : null;
}

const u32be = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const validKey = (k: Uint8Array) => {
  const n = BigInt(`0x${hex(k)}`);
  return n > 0n && n < secp256k1.Point.CURVE().n;
};
function labelledKey(seed: Uint8Array, text: string): Uint8Array {
  const label = new TextEncoder().encode(text);
  for (let i = 0; i < 10; i++) {
    const msg = new Uint8Array(label.length + 4);
    msg.set(label);
    msg.set(u32be(i), label.length);
    const k = hmac(sha256, seed, msg);
    if (validKey(k)) return k;
  }
  throw new Error("no key for this label");
}

/** The person's one key for every NEAR room, per account. */
export const roomKey = (seed: Uint8Array, account: string): Uint8Array => labelledKey(seed, `zerofee/near-rooms/${account}`);
/** The person's named key in one place (never BitChat's anonymous place key). */
export const namedPlaceKey = (seed: Uint8Array, account: string, geohash: string): Uint8Array => labelledKey(seed, `zerofee/named/${account}/${geohash}`);

const refuse = (why: string): never => {
  throw new ProblemError(securityProblems.requestInvalid(why));
};

/** Which key a chat request names (M4: exactly one of `room` and `geohash`; the key and the event both follow it). */
export type ChatKeyAsk = { kind: "room"; room: string | true } | { kind: "place"; geohash: string; named: boolean };
export function chatKeyAsk(p: Record<string, unknown>): ChatKeyAsk {
  const room = p.room !== undefined;
  const place = p.geohash !== undefined;
  if (room === place) refuse("a request names a room or a place, one of them");
  if (room) {
    if (p.room !== true && !isRoomId(p.room)) refuse("a room is near:<account> or token:<COIN>");
    if (p.named !== undefined) refuse("a room's name is always the account");
    return { kind: "room", room: p.room as string | true };
  }
  if (!isGeohash(p.geohash)) refuse("a place is 2 to 12 geohash letters");
  if (p.named !== undefined && p.named !== true && p.named !== false) refuse("named is true or false");
  if (p.named === true && (p.geohash as string).length > NAMED_PLACE_MAX) refuse("a NEAR account is shown only in a city or wider");
  return { kind: "place", geohash: p.geohash as string, named: p.named === true };
}

/** The secret for a request's key. `account`: the core's own account (never the app's), needed for rooms and names. */
export function chatSecret(seed: Uint8Array, ask: ChatKeyAsk, account: string | null): Uint8Array {
  if (ask.kind === "place" && !ask.named) return placeKey(seed, ask.geohash);
  if (!isAccountId(account)) throw new ProblemError(securityProblems.accountNone());
  return ask.kind === "room" ? roomKey(seed, account) : namedPlaceKey(seed, account, ask.geohash);
}

/** A NEAR room's message, checked and built here: kind 9, ["h", room], 1 to 2,000 characters. */
export function roomFields(p: Record<string, unknown>, nowSeconds: number): Pick<NostrEvent, "created_at" | "kind" | "tags" | "content"> {
  if (!isRoomId(p.room)) refuse("a room is near:<account> or token:<COIN>");
  if (p.kind !== ROOM_MESSAGE) refuse("a room's message is kind 9");
  if (typeof p.content !== "string" || !p.content.trim() || p.content.length > MAX_CONTENT) refuse(`a message is 1 to ${MAX_CONTENT} characters`);
  if (p.nickname !== undefined || p.teleport !== undefined) refuse("a room's message has no nickname: the name is the account");
  return { created_at: Math.floor(nowSeconds), kind: ROOM_MESSAGE, tags: [["h", p.room as string]], content: p.content as string };
}

/** Signs a NEAR room's message with the room key of `account`. */
export function signRoom(seed: Uint8Array, account: string, p: Record<string, unknown>, nowSeconds = Date.now() / 1000): NostrEvent {
  const fields = roomFields(p, nowSeconds);
  const secret = roomKey(seed, account);
  try {
    return signEvent(secret, fields);
  } finally {
    secret.fill(0);
  }
}

// ── The name: the account's note, and the chat key's record of it ──────────────────────────────────────────────────

/** The note's four lines. */
export function chatNameMessage(account: string, chatKey: string, until: string): string {
  return `${CHAT_NAME_FIRST_LINE}\nAccount: ${account}\nChat key: ${chatKey}\nUntil: ${until}`;
}

/** The note's "Until": NAME_DAYS from now, to the millisecond (ISO, UTC). */
export const nameUntil = (nowMs = Date.now()): string => new Date(nowMs + NAME_DAYS * DAY_MS).toISOString();

/** The note's parts as the core (and the phone's chip, NearTx.swift ChatName) accept them: null, or why not. */
export function noteRefusal(account: string, chatKey: string, until: string, nonceBase64: string, nowMs = Date.now()): string | null {
  if (!isAccountId(account)) return "account is a NEAR account name";
  if (!/^[0-9a-f]{64}$/.test(chatKey)) return "chat key is 64 hex";
  if (!ISO.test(until) || !(Date.parse(until) > nowMs) || Date.parse(until) > nowMs + 90 * DAY_MS) return "until is at most 90 days ahead";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(nonceBase64)) return "nonce is 32 bytes";
  return null;
}

/** The 32 bytes the account's key signs (NEP-413). */
export function chatNameHash(account: string, chatKey: string, until: string, nonceBase64: string): Uint8Array {
  return nep413Hash({ message: chatNameMessage(account, chatKey, until), nonce: nonceBase64, recipient: CHAT_NAME_RECIPIENT });
}

/** What the chat key signs: the account, the note's key, its signature, nonce and end (NEAR's text forms). */
export interface ChatNameRecord {
  v: 1;
  account: string;
  publicKey: string;
  signature: string;
  nonce: string;
  until: string;
}

/** Is `signature` `publicKey`'s over `hash`? ML-DSA-65 (a ZeroFee account's keys) or ed25519. Never throws. */
export function nearSignatureOk(publicKey: string, signature: string, hash: Uint8Array): boolean {
  try {
    if (publicKey.length > MAX_KEY_TEXT || signature.length > MAX_SIG_TEXT) return false;
    if (publicKey.startsWith("ml-dsa-65:") && signature.startsWith("ml-dsa-65:")) {
      return verifyHash({ hash, signature: base58Decode(signature.slice(10)), publicKey: publicKey as Parameters<typeof verifyHash>[0]["publicKey"] }) === true;
    }
    if (publicKey.startsWith("ed25519:") && signature.startsWith("ed25519:")) {
      const key = base58Decode(publicKey.slice(8));
      const sig = base58Decode(signature.slice(8));
      return key.length === 32 && sig.length === 64 && ed25519.verify(sig, hash, key);
    }
  } catch {
    /* not a signature */
  }
  return false;
}

/** The record's own check, before NEAR is asked: its shape, in date, and the account's note naming exactly this key. */
export function recordSigned(r: unknown, chatKey: string, nowMs = Date.now()): r is ChatNameRecord {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  if (x.v !== 1 || !isAccountId(x.account) || typeof x.publicKey !== "string" || typeof x.signature !== "string" || typeof x.nonce !== "string" || typeof x.until !== "string") return false;
  if (noteRefusal(x.account, chatKey, x.until, x.nonce, nowMs) !== null) return false;
  return nearSignatureOk(x.publicKey, x.signature, chatNameHash(x.account, chatKey, x.until, x.nonce));
}

/** The chat key's record event (signed by `secret`): the record, or empty content to take the name back. */
export function nameEvent(secret: Uint8Array, record: ChatNameRecord | null, nowSeconds = Date.now() / 1000): NostrEvent {
  return signEvent(secret, { created_at: Math.floor(nowSeconds), kind: CHAT_NAME_KIND, tags: [["d", CHAT_NAME_D]], content: record ? JSON.stringify(record) : "" });
}

/** A name event as a reader takes it (its id and signature already checked: pool.ts): the record and whose it is, null
 *  when it takes a name back, undefined when it isn't one or is out of date (L2, H2c). Whether the note's key is still
 *  the account's is NEAR's to say (chat-reads.ts keyOnAccount). */
export function readNameEvent(e: NostrEvent, nowMs = Date.now()): { chatKey: string; at: number; record: ChatNameRecord | null } | undefined {
  if (e.kind !== CHAT_NAME_KIND || e.tags.length !== 1 || e.tags[0]!.length !== 2 || e.tags[0]![0] !== "d" || e.tags[0]![1] !== CHAT_NAME_D) return undefined;
  const now = nowMs / 1000;
  if (!Number.isSafeInteger(e.created_at) || e.created_at > now + AHEAD_SECONDS) return undefined;
  if (e.content === "") return { chatKey: e.pubkey, at: e.created_at, record: null };
  if (e.created_at < now - RECORD_MAX_AGE_SECONDS) return undefined;
  if (e.content.length > MAX_KEY_TEXT + MAX_SIG_TEXT + 500) return undefined;
  let r: unknown;
  try {
    r = JSON.parse(e.content);
  } catch {
    return undefined;
  }
  return recordSigned(r, e.pubkey, nowMs) ? { chatKey: e.pubkey, at: e.created_at, record: r } : undefined;
}
