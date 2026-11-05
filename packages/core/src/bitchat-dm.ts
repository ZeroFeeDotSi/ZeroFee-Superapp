// BitChat's private messages over Nostr ("geohash DMs", D55 slice 2), ported from BitChat's iOS source at
// permissionlesstech/bitchat 04995f68 (public domain, Unlicense). Never from the Android code (GPL).
//
// BitChat says of it (NostrProtocol.swift): "deliberately BitChat-specific and not NIP-17, NIP-44, or NIP-59
// compatible, even though it historically reuses those NIPs' kind numbers (1059/13/14) and a `v2:` content prefix". So
// nothing here is a Nostr DM library; it is BitChat's construction, byte for byte:
//
//   wrap  kind 1059, signed by a one-time key, tags [["p", recipient]], created_at jittered ±15 min,
//         content = v2(seal JSON) from the one-time key to the recipient
//   seal  kind 13, signed by the sender's key for the place, tags [], created_at jittered ±15 min,
//         content = v2(rumor JSON) from the sender's key to the recipient
//   rumor kind 14, unsigned, tags [] (BitChat Android writes [["p", recipient]]; both are read), the real created_at,
//         content = "bitchat1:" + base64url(BitchatPacket)
//   v2(x) = "v2:" + base64url(nonce24 ‖ XChaCha20-Poly1305(key, nonce24, x) ‖ tag16), no padding, where
//         key = HKDF-SHA256(ikm = the 33-byte compressed ECDH point, salt = "", info = "nip44-v2", 32 bytes)
//         (the x-only public key is lifted with 0x02 to encrypt; a reader tries 0x02, then 0x03)
//
// The packet (BitFoundation BinaryProtocol, version 1): version, type 0x11 (noiseEncrypted), ttl 7, timestamp ms u64,
// flags, payload length u16, an 8-byte random sender id (BitChat's unlinkableSenderID), the payload, then PKCS#7-style
// padding to 256/512/1024/2048 (MessagePadding). The payload is one NoisePayloadType byte (0x01 private message, 0x02
// read, 0x03 delivered) and, for a message, the TLV PrivateMessagePacket: 0x00 len messageID, 0x01 len content, each at
// most 255 bytes. BitChat deflates a payload of 100 bytes or more when it has few distinct bytes (CompressionUtil, flag
// 0x04, Apple's raw DEFLATE): we never compress what we send (its reader takes either) and read both.
//
// Keys: every secret here is the core's (nostr.ts placeKey, a fresh one-time key per wrap). Pure: no network, no store.
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { isGeohash, placeKey, publicKeyHex, signEvent, verifyEvent, type NostrEvent } from "./nostr.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

export const GIFT_WRAP = 1059;
export const SEAL = 13;
export const RUMOR = 14;
/** NostrProtocol.maximumPrivateEnvelopeCiphertextBytes: a layer's content, and its decrypted JSON, at most 64 KiB. */
export const MAX_ENVELOPE = 64 * 1024;
/** PrivateMessagePacket's TLV length byte: a message's text and its id are at most 255 bytes of UTF-8 each. */
export const MAX_DM_BYTES = 255;
/** NostrProtocol.randomizedTimestamp: ±15 minutes on the wrap and the seal. */
export const JITTER_SECONDS = 900;
/** NostrInboundPipeline.isPlausibleRumorTimestamp: a day back (the DM look-back) and 15 minutes ahead, plus skew. */
export const DM_LOOKBACK_SECONDS = 86_400;
export const DM_SKEW_SECONDS = 900;

export const PACKET_NOISE_ENCRYPTED = 0x11;
export const PAYLOAD_MESSAGE = 0x01;
export const PAYLOAD_READ = 0x02;
export const PAYLOAD_DELIVERED = 0x03;
const FLAG_RECIPIENT = 0x01;
const FLAG_SIGNATURE = 0x02;
const FLAG_COMPRESSED = 0x04;
const FLAG_ROUTE = 0x08;
const HEADER_V1 = 14;
const HEADER_V2 = 16;
const ID_SIZE = 8;
const SIGNATURE_SIZE = 64;
/** What a DM's payload may unpack to here: a message is at most 1 + 2 + 255 + 2 + 255 bytes; 4 KiB is ample. */
export const MAX_PAYLOAD = 4096;
/** BitChat's PacketPayloadLimits.maxDeflateRatio: an original size beyond this many times the compressed one is a lie. */
const MAX_DEFLATE_RATIO = 1032;

const enc = new TextEncoder();
const utf8 = (s: string) => enc.encode(s);
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const HEX64 = /^[0-9a-f]{64}$/;

export class DmRefused extends Error {
  readonly why: "ciphertext" | "event";
  constructor(why: "ciphertext" | "event", detail: string) {
    super(detail);
    this.why = why;
  }
}
const badCiphertext = (d: string): never => {
  throw new DmRefused("ciphertext", d);
};
const badEvent = (d: string): never => {
  throw new DmRefused("event", d);
};

// --- base64url (Base64URLCoding.swift): no padding out; strict in (Foundation's Data(base64Encoded:) is) -----------

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// --- the v2 layer (NostrProtocol encrypt/decrypt, derivePrivateEnvelopeKey) ---------------------------------------

/** HKDF-SHA256 over the 33-byte compressed ECDH point, salt empty, info "nip44-v2" (the historical label). */
export function envelopeKey(sharedPoint: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedPoint, new Uint8Array(0), utf8("nip44-v2"), 32);
}

/** P256K's sharedSecretFromKeyAgreement(format: .compressed): the shared point, compressed (33 bytes). */
export function sharedPoint(secret: Uint8Array, xOnlyHex: string, prefix: "02" | "03" = "02"): Uint8Array {
  if (!HEX64.test(xOnlyHex)) badCiphertext("a public key is 64 hex");
  return secp256k1.getSharedSecret(secret, fromHex(prefix + xOnlyHex), true);
}

/** "v2:" + base64url(nonce24 ‖ ciphertext ‖ tag16), from `secret` to the x-only key `toHex` (lifted with 0x02). */
export function encryptV2(plaintext: string, toHex: string, secret: Uint8Array, nonce24: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(24))): string {
  if (nonce24.length !== 24) throw new Error("a nonce is 24 bytes");
  const key = envelopeKey(sharedPoint(secret, toHex, "02"));
  try {
    const sealed = xchacha20poly1305(key, nonce24).encrypt(utf8(plaintext));
    const out = new Uint8Array(24 + sealed.length);
    out.set(nonce24);
    out.set(sealed, 24);
    return `v2:${base64url(out)}`;
  } finally {
    key.fill(0);
  }
}

/** Opens a v2 layer sent by the x-only key `fromHex` to `secret`: even Y first, then odd, as BitChat does. */
export function decryptV2(content: string, fromHex: string, secret: Uint8Array): string {
  if (typeof content !== "string" || utf8(content).length > MAX_ENVELOPE || !content.startsWith("v2:")) badCiphertext("not BitChat's v2 framing");
  const data = fromBase64url(content.slice(3));
  if (!data || data.length <= 24 + 16) return badCiphertext("too short or not base64url");
  if (!HEX64.test(fromHex)) return badCiphertext("a public key is 64 hex");
  const nonce = data.subarray(0, 24);
  const sealed = data.subarray(24);
  for (const prefix of ["02", "03"] as const) {
    let key: Uint8Array;
    try {
      key = envelopeKey(sharedPoint(secret, fromHex, prefix));
    } catch {
      continue;
    }
    try {
      const plain = xchacha20poly1305(key, nonce).decrypt(sealed);
      try {
        return strictUtf8.decode(plain);
      } catch {
        return badCiphertext("authenticated, but not UTF-8");
      }
    } catch (e) {
      if (e instanceof DmRefused) throw e;
    } finally {
      key.fill(0);
    }
  }
  return badCiphertext("doesn't open with this key");
}

// --- events ---------------------------------------------------------------------------------------------------------

/** NostrEvent(from: dict): the fields BitChat requires, its inbound tag limits (64 tags, 16 values, 1,024 bytes). */
interface Layer {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: unknown;
}

function parseLayer(json: string): Layer {
  if (utf8(json).length > MAX_ENVELOPE) badCiphertext("a layer over 64 KiB");
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return badEvent("not JSON");
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return badEvent("not an object");
  const x = d as Record<string, unknown>;
  if (typeof x.pubkey !== "string" || !Number.isSafeInteger(x.created_at) || !Number.isSafeInteger(x.kind) || typeof x.content !== "string" || !Array.isArray(x.tags)) badEvent("missing fields");
  const tags = x.tags as unknown[];
  if (tags.length > 64) badEvent("too many tags");
  for (const t of tags) if (!Array.isArray(t) || t.length > 16 || !t.every((v) => typeof v === "string" && utf8(v).length <= 1024)) badEvent("a tag out of bounds");
  return { id: typeof x.id === "string" ? x.id : "", pubkey: x.pubkey as string, created_at: x.created_at as number, kind: x.kind as number, tags: tags as string[][], content: x.content as string, ...("sig" in x ? { sig: x.sig } : {}) };
}

const sameTags = (a: string[][], b: string[][]) => a.length === b.length && a.every((t, i) => t.length === b[i]!.length && t.every((v, j) => v === b[i]![j]));

export interface Opened {
  /** The rumor's content: "bitchat1:…" from a BitChat client. */
  content: string;
  /** The seal's signer: the sender's key for the place (authenticated). */
  from: string;
  /** The rumor's own time (the wrap's and the seal's are jittered). */
  at: number;
}

/**
 * NostrProtocol.decryptPrivateMessage, with every check it makes, in its order: the outer envelope's size, kind, its
 * one `p` tag naming this key, its signature; the seal's kind, no tags, its signature; the rumor's kind, its tags (none,
 * or the one `p` tag Android writes), no signature, and its pubkey the seal's signer. Throws DmRefused.
 */
export function openEnvelope(secret: Uint8Array, wrap: unknown): Opened {
  const me = publicKeyHex(secret);
  const w = wrap as NostrEvent;
  if (!w || typeof w !== "object" || typeof w.content !== "string") return badEvent("not an event");
  if (utf8(w.content).length > MAX_ENVELOPE) badCiphertext("oversized outer envelope");
  if (w.kind !== GIFT_WRAP || !Array.isArray(w.tags) || !sameTags(w.tags, [["p", me]]) || !verifyEvent(w)) badEvent("malformed or misbound outer envelope");
  const seal = parseLayer(decryptV2(w.content, w.pubkey, secret));
  if (seal.kind !== SEAL || seal.tags.length !== 0 || !verifyEvent(seal)) badEvent("the seal is malformed or unsigned");
  const rumor = parseLayer(decryptV2(seal.content, seal.pubkey, secret));
  if (rumor.kind !== RUMOR || !(rumor.tags.length === 0 || sameTags(rumor.tags, [["p", me]])) || typeof rumor.sig === "string" || seal.pubkey !== rumor.pubkey) {
    badEvent("the rumor is malformed or isn't the seal signer's");
  }
  return { content: rumor.content, from: seal.pubkey, at: rumor.created_at };
}

/** NostrInboundPipeline.isPlausibleRumorTimestamp. */
export const plausibleRumorTime = (at: number, nowSeconds: number): boolean => {
  const age = nowSeconds - at;
  return age >= -DM_SKEW_SECONDS && age <= DM_LOOKBACK_SECONDS + DM_SKEW_SECONDS;
};

export interface SealOptions {
  nowSeconds?: number;
  /** Seconds to add to the seal's and the wrap's times, each in [-900, 900] (default random, as BitChat's). */
  jitter?: () => number;
  /** The wrap's one-time key (default fresh); tests fix it. */
  wrapSecret?: Uint8Array;
  /** The two layers' nonces (default random). */
  nonces?: [Uint8Array, Uint8Array];
}

const randomJitter = () => {
  const r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  return Math.floor(r * (2 * JITTER_SECONDS + 1)) - JITTER_SECONDS;
};

/** NostrProtocol.createPrivateMessage: rumor → seal (sender's key) → wrap (a one-time key), to the x-only key `to`. */
export function sealEnvelope(secret: Uint8Array, to: string, content: string, options: SealOptions = {}): NostrEvent {
  if (!HEX64.test(to)) throw new Error("a recipient is 64 hex");
  const now = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  const jitter = options.jitter ?? randomJitter;
  const pubkey = publicKeyHex(secret);
  const rumor = { id: "", pubkey, created_at: now, kind: RUMOR, tags: [] as string[][], content };
  const sealContent = encryptV2(JSON.stringify(rumor), to, secret, options.nonces?.[0]);
  const seal = signEvent(secret, { created_at: now + jitter(), kind: SEAL, tags: [], content: sealContent });
  const wrapSecret = options.wrapSecret ?? secp256k1.utils.randomSecretKey();
  try {
    const wrapContent = encryptV2(JSON.stringify(seal), to, wrapSecret, options.nonces?.[1]);
    return signEvent(wrapSecret, { created_at: now + jitter(), kind: GIFT_WRAP, tags: [["p", to]], content: wrapContent });
  } finally {
    if (!options.wrapSecret) wrapSecret.fill(0);
  }
}

/** Is this a public key a DM can go to (x-only, on the curve)? */
export function isRecipient(x: unknown): x is string {
  if (typeof x !== "string" || !HEX64.test(x)) return false;
  try {
    schnorr.utils.lift_x(BigInt(`0x${x}`));
    return true;
  } catch {
    return false;
  }
}

// --- the packet (BitFoundation BinaryProtocol, MessagePadding; Packets.swift PrivateMessagePacket) ------------------

export interface Packet {
  version: number;
  type: number;
  ttl: number;
  timestampMs: bigint;
  flags: number;
  senderId: Uint8Array;
  recipientId: Uint8Array | null;
  payload: Uint8Array;
}

/** PrivateMessagePacket.encode: 0x00 len id, 0x01 len content; null when either is over 255 bytes. */
export function privateMessageTlv(messageId: string, text: string): Uint8Array | null {
  const id = utf8(messageId);
  const body = utf8(text);
  if (id.length > MAX_DM_BYTES || body.length > MAX_DM_BYTES) return null;
  const out = new Uint8Array(4 + id.length + body.length);
  out[0] = 0x00;
  out[1] = id.length;
  out.set(id, 2);
  out[2 + id.length] = 0x01;
  out[3 + id.length] = body.length;
  out.set(body, 4 + id.length);
  return out;
}

/** PrivateMessagePacket.decode: types 0x00/0x01 only, both present; the last of a repeated type wins (as BitChat). */
export function readPrivateMessageTlv(data: Uint8Array): { messageId: string; text: string } | null {
  let at = 0;
  let id: string | null = null;
  let text: string | null = null;
  while (at + 2 <= data.length) {
    const type = data[at]!;
    if (type !== 0x00 && type !== 0x01) return null;
    const len = data[at + 1]!;
    at += 2;
    if (at + len > data.length) return null;
    let value: string | null;
    try {
      value = strictUtf8.decode(data.subarray(at, at + len));
    } catch {
      value = null; // Swift's String(data:encoding:) is nil for bad UTF-8: that field reads as missing
    }
    at += len;
    if (type === 0x00) id = value;
    else text = value;
  }
  return id !== null && text !== null ? { messageId: id, text } : null;
}

/** MessagePadding.optimalBlockSize then pad: to the first of 256/512/1024/2048 that fits size + 16, if ≤255 to add. */
function pad(data: Uint8Array): Uint8Array {
  const total = data.length + 16;
  const block = [256, 512, 1024, 2048].find((b) => total <= b) ?? data.length;
  const need = block - data.length;
  if (need <= 0 || need > 255) return data;
  const out = new Uint8Array(block);
  out.set(data);
  out.fill(need, data.length);
  return out;
}

/** BinaryProtocol.encode for a version-1 packet, never compressed, no recipient, no signature, padded. */
export function encodePacket(p: { type: number; ttl: number; timestampMs: bigint; senderId: Uint8Array; payload: Uint8Array }): Uint8Array {
  if (p.payload.length > 0xffff) throw new Error("payload too long");
  const head = new Uint8Array(HEADER_V1 + ID_SIZE);
  head[0] = 1;
  head[1] = p.type;
  head[2] = p.ttl;
  for (let i = 0; i < 8; i++) head[3 + i] = Number((p.timestampMs >> BigInt(56 - 8 * i)) & 0xffn);
  head[11] = 0;
  head[12] = p.payload.length >> 8;
  head[13] = p.payload.length & 0xff;
  head.set(p.senderId.subarray(0, ID_SIZE), HEADER_V1);
  const out = new Uint8Array(head.length + p.payload.length);
  out.set(head);
  out.set(p.payload, head.length);
  return pad(out);
}

/** Raw DEFLATE (RFC 1951) to at most `size` bytes: the browser's DecompressionStream; null when it can't. */
export type Inflate = (data: Uint8Array, size: number) => Promise<Uint8Array | null>;
export const inflateRaw: Inflate = async (data, size) => {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) return null;
  try {
    const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DS("deflate-raw")).getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > size) {
        void reader.cancel();
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  } catch {
    return null;
  }
};

/** BinaryProtocol.decodeCore, bounded for a DM: versions 1 and 2, every flag, compressed or not; null when malformed. */
async function decodeCore(raw: Uint8Array, inflate: Inflate): Promise<Packet | null> {
  if (raw.length < HEADER_V1 + ID_SIZE) return null;
  const version = raw[0]!;
  if (version !== 1 && version !== 2) return null;
  const header = version === 2 ? HEADER_V2 : HEADER_V1;
  const lenBytes = version === 2 ? 4 : 2;
  if (raw.length < header + ID_SIZE) return null;
  let at = 1;
  const type = raw[at++]!;
  const ttl = raw[at++]!;
  let ts = 0n;
  for (let i = 0; i < 8; i++) ts = (ts << 8n) | BigInt(raw[at++]!);
  const flags = raw[at++]!;
  const readLen = () => {
    let n = 0;
    for (let i = 0; i < lenBytes; i++) n = n * 256 + raw[at++]!;
    return n;
  };
  const length = readLen();
  const need = (n: number) => at + n <= raw.length;
  if (!need(ID_SIZE)) return null;
  const senderId = raw.slice(at, at + ID_SIZE);
  at += ID_SIZE;
  let recipientId: Uint8Array | null = null;
  if (flags & FLAG_RECIPIENT) {
    if (!need(ID_SIZE)) return null;
    recipientId = raw.slice(at, at + ID_SIZE);
    at += ID_SIZE;
  }
  if (version >= 2 && flags & FLAG_ROUTE) {
    if (!need(1)) return null;
    const hops = raw[at++]!;
    if (!need(hops * ID_SIZE)) return null;
    at += hops * ID_SIZE;
  }
  let payload: Uint8Array;
  if (flags & FLAG_COMPRESSED) {
    if (length < lenBytes || !need(lenBytes)) return null;
    const original = readLen();
    if (original > MAX_PAYLOAD) return null;
    const compressed = length - lenBytes;
    if (compressed <= 0 || !need(compressed) || original > compressed * MAX_DEFLATE_RATIO) return null;
    const out = await inflate(raw.subarray(at, at + compressed), original);
    if (!out || out.length !== original) return null;
    payload = out;
    at += compressed;
  } else {
    if (length > MAX_PAYLOAD || !need(length)) return null;
    payload = raw.slice(at, at + length);
    at += length;
  }
  if (flags & FLAG_SIGNATURE) {
    if (!need(SIGNATURE_SIZE)) return null;
    at += SIGNATURE_SIZE;
  }
  return { version, type, ttl, timestampMs: ts, flags, senderId, recipientId, payload };
}

/** MessagePadding.unpad: strip a valid PKCS#7 tail, else the bytes as they are. */
function unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const n = data[data.length - 1]!;
  if (n === 0 || n > data.length) return data;
  for (let i = data.length - n; i < data.length; i++) if (data[i] !== n) return data;
  return data.subarray(0, data.length - n);
}

/** BinaryProtocol.decode: as it is first, then with its padding taken off. */
export async function decodePacket(raw: Uint8Array, inflate: Inflate = inflateRaw): Promise<Packet | null> {
  const first = await decodeCore(raw, inflate);
  if (first) return first;
  const unpadded = unpad(raw);
  return unpadded === raw ? null : decodeCore(unpadded, inflate);
}

export type DmPayload =
  | { kind: "message"; messageId: string; text: string }
  | { kind: "delivered" | "read"; messageId: string };

/** The rumor's content as BitChat reads a geohash DM: "bitchat1:" + a noiseEncrypted packet with a message or an ack. */
export async function readDmContent(content: string, inflate: Inflate = inflateRaw): Promise<DmPayload | null> {
  if (typeof content !== "string" || !content.startsWith("bitchat1:") || content.length > 16 * 1024) return null;
  const bytes = fromBase64url(content.slice("bitchat1:".length));
  if (!bytes) return null;
  const packet = await decodePacket(bytes, inflate);
  if (!packet || packet.type !== PACKET_NOISE_ENCRYPTED || packet.payload.length === 0) return null;
  const type = packet.payload[0]!;
  const data = packet.payload.subarray(1);
  if (type === PAYLOAD_MESSAGE) {
    const pm = readPrivateMessageTlv(data);
    return pm ? { kind: "message", ...pm } : null;
  }
  if (type === PAYLOAD_DELIVERED || type === PAYLOAD_READ) {
    let messageId: string;
    try {
      messageId = strictUtf8.decode(data);
    } catch {
      return null;
    }
    return messageId ? { kind: type === PAYLOAD_DELIVERED ? "delivered" : "read", messageId } : null;
  }
  return null; // groups, voice, files, verification: mesh only (NostrInboundPipeline ignores them over Nostr too)
}

/** NostrEmbeddedBitChat.encodePMForNostrNoRecipient / encodeAckForNostrNoRecipient: random sender id, ttl 7. */
export function dmContent(p: DmPayload, options: { timestampMs?: bigint; senderId?: Uint8Array } = {}): string {
  let payload: Uint8Array;
  if (p.kind === "message") {
    const tlv = privateMessageTlv(p.messageId, p.text);
    if (!tlv) throw new Error("a message and its id are at most 255 bytes each");
    payload = new Uint8Array(1 + tlv.length);
    payload[0] = PAYLOAD_MESSAGE;
    payload.set(tlv, 1);
  } else {
    const id = utf8(p.messageId);
    payload = new Uint8Array(1 + id.length);
    payload[0] = p.kind === "delivered" ? PAYLOAD_DELIVERED : PAYLOAD_READ;
    payload.set(id, 1);
  }
  const packet = encodePacket({
    type: PACKET_NOISE_ENCRYPTED,
    ttl: 7,
    timestampMs: options.timestampMs ?? BigInt(Date.now()),
    senderId: options.senderId ?? globalThis.crypto.getRandomValues(new Uint8Array(ID_SIZE)),
    payload,
  });
  return `bitchat1:${base64url(packet)}`;
}

// --- what the core answers (nostr.seal, nostr.open: ZeroFee Chat only; demo-core.ts, MockBridge.ts) -----------------

const refuse = (why: string): never => {
  throw new ProblemError(securityProblems.requestInvalid(why));
};

/** A BitChat message id: UUID().uuidString, upper case (ChatPrivateConversationCoordinator). */
export function newMessageId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** An id an ack may name: what we or a BitChat client made (printable ASCII, at most 128). */
const ACK_ID = /^[\x21-\x7e]{1,128}$/;

/**
 * nostr.seal: one private message, or a delivered / read ack, from this person's key for `geohash` to `to` (the key
 * they wrote with in that place). The core builds the packet and every layer itself: an app's own bytes, kinds, tags
 * or times are never used. Returns the wrap to post and the message's id.
 */
export function sealChatDm(seed: Uint8Array, p: Record<string, unknown>, options: SealOptions & { messageId?: string; secret?: Uint8Array } = {}): { event: NostrEvent; messageId: string } {
  if (!isGeohash(p.geohash)) refuse("a place is 2 to 12 geohash letters");
  if (!isRecipient(p.to)) refuse("a private message goes to one person's key in the place");
  let payload: DmPayload;
  if (p.kind === "message") {
    if (typeof p.text !== "string" || !p.text.trim() || utf8(p.text).length > MAX_DM_BYTES) refuse(`a private message is 1 to ${MAX_DM_BYTES} bytes (BitChat's limit)`);
    // A message sent again (J3 C4: no "Delivered" in 10 s, the person taps Send again) keeps its id, so the other side
    // shows it once and acks it; any other message gets a new one.
    if (p.messageId !== undefined && (typeof p.messageId !== "string" || !ACK_ID.test(p.messageId))) refuse("a message sent again keeps its own id");
    payload = { kind: "message", messageId: options.messageId ?? (p.messageId as string | undefined) ?? newMessageId(), text: p.text as string };
  } else if (p.kind === "delivered" || p.kind === "read") {
    if (typeof p.messageId !== "string" || !ACK_ID.test(p.messageId)) refuse("an ack names the message it answers");
    payload = { kind: p.kind, messageId: p.messageId as string };
  } else {
    return refuse("a private message, or a delivered or read ack");
  }
  // `options.secret`: the person's named key in this place (chat-near.ts namedPlaceKey), else BitChat's place key.
  const secret = options.secret ?? placeKey(seed, p.geohash as string);
  try {
    if (publicKeyHex(secret) === p.to) refuse("that's you in this place");
    const event = sealEnvelope(secret, p.to as string, dmContent(payload), options);
    return { event, messageId: payload.messageId };
  } finally {
    secret.fill(0);
  }
}

/**
 * nostr.open: a kind-1059 wrap for this person's key in `geohash`, opened (every BitChat check, and a plausible
 * time). Null for anything else: not ours, forged, malformed, stale. The content is the sender's packet, still to be
 * read (readDmContent): it may be deflated, and the core has no DecompressionStream in the phone's script context.
 */
export function openChatDm(seed: Uint8Array, p: Record<string, unknown>, nowSeconds = Date.now() / 1000, named?: Uint8Array): Opened | null {
  if (!isGeohash(p.geohash)) refuse("a place is 2 to 12 geohash letters");
  const secret = named ?? placeKey(seed, p.geohash as string);
  try {
    const opened = openEnvelope(secret, p.event);
    return plausibleRumorTime(opened.at, Math.floor(nowSeconds)) ? opened : null;
  } catch (e) {
    if (e instanceof DmRefused) return null;
    throw e;
  } finally {
    secret.fill(0);
  }
}
