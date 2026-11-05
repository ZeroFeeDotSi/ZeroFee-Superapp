// BitChat's private messages (D55 slice 2) against BitChat's own: its frozen fixtures (bitchatTests/Nostr/Fixtures, an
// envelope from the released iOS app 733098bb and one from Android b7f0b33d, public domain data in the iOS repo), and
// a port of every NostrProtocolTests case. The vectors BitChat's own Swift computes (tools/chat/bitchat-swift) are
// checked byte for byte in bitchat-dm.vectors.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  DmRefused, GIFT_WRAP, MAX_ENVELOPE, base64url, envelopeKey, decodePacket, decryptV2, dmContent, encodePacket, encryptV2, fromBase64url, isRecipient,
  openEnvelope, plausibleRumorTime, privateMessageTlv, readDmContent, readPrivateMessageTlv, sealEnvelope, type Inflate,
} from "./bitchat-dm.ts";
import { publicKeyHex, signEvent, type NostrEvent } from "./nostr.ts";

const vectors = JSON.parse(readFileSync(new URL("./testing/nostr-vectors.json", import.meta.url), "utf8")) as { repo: Record<"ios" | "android", NostrEvent> };
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const key = () => secp256k1.utils.randomSecretKey();
const nodeInflate: Inflate = async (d, size) => {
  try {
    const out = inflateRawSync(d, { maxOutputLength: size });
    return new Uint8Array(out);
  } catch {
    return null;
  }
};
const refused = (fn: () => unknown, why: "ciphertext" | "event") => assert.throws(fn, (e: unknown) => e instanceof DmRefused && e.why === why);

test("BitChat iOS 733098bb's frozen envelope opens: its sender, its text (decryptsFrozenLegacyEnvelopeProducedByRelease733098bb)", async () => {
  const me = fromHex("8355a5c110cdfef2e644f4ad5d51c39f253b2c2c80ebb6856379fb16531dc1fa");
  const opened = openEnvelope(me, vectors.repo.ios);
  assert.equal(opened.from, "2e3d79df7047204f02b726c574e256f8de1dd80510f7dcb8b0d12df13acb87e6");
  assert.equal(opened.content, "legacy fixture from 733098bb");
  // A raw string, not a bitchat1: packet: the app reads it as nothing (BitChat's geohash pipeline drops it too).
  assert.equal(await readDmContent(opened.content), null);
});

test("BitChat Android b7f0b33d's frozen envelope opens, inner p tag and all (decryptsFrozenLegacyEnvelopeProducedByAndroidB7f0b33d)", () => {
  const me = fromHex("0000000000000000000000000000000000000000000000000000000000000002");
  assert.deepEqual(vectors.repo.android.tags, [["p", publicKeyHex(me)]]);
  const opened = openEnvelope(me, vectors.repo.android);
  assert.equal(opened.content, "legacy fixture from Android b7f0b33d");
  assert.equal(opened.from, "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
});

test("round trip (nip17MessageRoundTrip): the sender's place key signs the seal, the time inside is the real one", async () => {
  const alice = key();
  const bob = key();
  const content = dmContent({ kind: "message", messageId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301", text: "Hello from ZeroFee 👋" });
  const now = 1_800_000_000;
  const wrap = sealEnvelope(alice, publicKeyHex(bob), content, { nowSeconds: now });
  assert.equal(wrap.kind, GIFT_WRAP);
  assert.deepEqual(wrap.tags, [["p", publicKeyHex(bob)]]);
  assert.notEqual(wrap.pubkey, publicKeyHex(alice), "the outer key is a one-time key");
  assert.ok(Math.abs(wrap.created_at - now) <= 900);
  const opened = openEnvelope(bob, wrap);
  assert.deepEqual(opened, { content, from: publicKeyHex(alice), at: now });
  assert.deepEqual(await readDmContent(opened.content), { kind: "message", messageId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301", text: "Hello from ZeroFee 👋" });
});

test("every wrap has its own one-time key (giftWrapUsesUniqueEphemeralKeys); both open", () => {
  const [a, b] = [key(), key()];
  const one = sealEnvelope(a, publicKeyHex(b), "Message 1");
  const two = sealEnvelope(a, publicKeyHex(b), "Message 2");
  assert.notEqual(one.pubkey, two.pubkey);
  assert.equal(openEnvelope(b, one).content, "Message 1");
  assert.equal(openEnvelope(b, two).content, "Message 2");
});

test("refused like BitChat refuses: another recipient, another outer kind, a changed signature (decryptionFailsWithWrongRecipient, decryptRejectsWrongOuterKind)", () => {
  const [a, b, c] = [key(), key(), key()];
  const wrap = sealEnvelope(a, publicKeyHex(b), "Secret message");
  refused(() => openEnvelope(c, wrap), "event");
  const wrongKind = signEvent(key(), { created_at: wrap.created_at, kind: 1, tags: wrap.tags, content: wrap.content });
  refused(() => openEnvelope(b, wrongKind), "event");
  refused(() => openEnvelope(b, { ...wrap, sig: wrap.sig.replace(/^./, (x) => (x === "0" ? "1" : "0")) }), "event");
  refused(() => openEnvelope(b, { ...wrap, tags: [["p", publicKeyHex(b)], ["p", publicKeyHex(b)]] }), "event");
  refused(() => openEnvelope(b, null), "event");
});

/** BitChat's DEBUG generators, rebuilt from the layers: a rumor and a seal of our own choosing. */
function forge(sender: Uint8Array, to: Uint8Array, rumor: Record<string, unknown>, sealSigner = sender, breakSeal = false): NostrEvent {
  const toHex = publicKeyHex(to);
  const sealContent = encryptV2(JSON.stringify(rumor), toHex, sealSigner);
  let seal: NostrEvent | Record<string, unknown> = signEvent(sealSigner, { created_at: 1_800_000_000, kind: 13, tags: [], content: sealContent });
  if (breakSeal) seal = { ...seal, sig: "0".repeat(128) };
  const wrapKey = key();
  return signEvent(wrapKey, { created_at: 1_800_000_000, kind: GIFT_WRAP, tags: [["p", toHex]], content: encryptV2(JSON.stringify(seal), toHex, wrapKey) });
}

test("a forged seal, a spoofed sender, an alternate inner tag are refused; Android's one inner p tag is read (decryptRejects*, decryptAcceptsCurrentAndroidInnerRecipientTag)", () => {
  const [alice, bob, mallory, other] = [key(), key(), key(), key()];
  const rumor = (tags: string[][], pubkey = publicKeyHex(alice)) => ({ id: "", pubkey, created_at: 1_800_000_000, kind: 14, tags, content: "x" });
  refused(() => openEnvelope(bob, forge(alice, bob, rumor([]), alice, true)), "event");
  refused(() => openEnvelope(bob, forge(alice, bob, rumor([]), mallory)), "event");
  for (const tags of [[["p", publicKeyHex(other)]], [["p", publicKeyHex(bob)], ["p", publicKeyHex(bob)]], [["p", publicKeyHex(bob), "unexpected"]], [["x", publicKeyHex(bob)]]]) {
    refused(() => openEnvelope(bob, forge(alice, bob, rumor(tags))), "event");
  }
  assert.equal(openEnvelope(bob, forge(alice, bob, rumor([["p", publicKeyHex(bob)]]))).from, publicKeyHex(alice));
  refused(() => openEnvelope(bob, forge(alice, bob, { ...rumor([]), kind: 1 })), "event");
  refused(() => openEnvelope(bob, forge(alice, bob, { ...rumor([]), sig: "a".repeat(128) })), "event");
  refused(() => openEnvelope(bob, forge(alice, bob, { ...rumor([]), created_at: 1.5 })), "event");
});

test("oversized and non-BitChat ciphertexts are refused before any work (decryptRejectsOversizedCiphertextBeforeDecoding, decryptDoesNotMisinterpretStandardNIP44Payload)", () => {
  const [w, me] = [key(), key()];
  const wrapOf = (content: string) => signEvent(w, { created_at: 1_800_000_000, kind: GIFT_WRAP, tags: [["p", publicKeyHex(me)]], content });
  refused(() => openEnvelope(me, wrapOf(`v2:${"A".repeat(MAX_ENVELOPE)}`)), "ciphertext");
  const nip44 = "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb";
  refused(() => openEnvelope(me, wrapOf(nip44)), "ciphertext");
  refused(() => openEnvelope(me, wrapOf("v2:AAAA")), "ciphertext");
  refused(() => openEnvelope(me, wrapOf("v2:not*base64url")), "ciphertext");
});

test("the v2 layer: XChaCha20-Poly1305 with HKDF over the compressed ECDH point; authenticated non-UTF-8 is refused", () => {
  const [a, b] = [key(), key()];
  const nonce = new Uint8Array(24).fill(7);
  const ct = encryptV2("hi", publicKeyHex(b), a, nonce);
  assert.ok(ct.startsWith("v2:") && !ct.includes("="));
  assert.deepEqual(fromBase64url(ct.slice(3))!.subarray(0, 24), nonce);
  assert.equal(decryptV2(ct, publicKeyHex(a), b), "hi");
  // Not UTF-8 inside a valid seal: the core's own key, the same construction, bad bytes.
  const shared = secp256k1.getSharedSecret(a, fromHex(`02${publicKeyHex(b)}`), true);
  assert.equal(shared.length, 33, "the compressed point, as P256K's .compressed key agreement gives it");
  const sealed = xchacha20poly1305(envelopeKey(shared), nonce).encrypt(Uint8Array.from([0xff, 0xfe]));
  const bad = `v2:${base64url(Uint8Array.from([...nonce, ...sealed]))}`;
  refused(() => decryptV2(bad, publicKeyHex(a), b), "ciphertext");
});

test("the packet: BinaryProtocol v1, ttl 7, a random 8-byte sender, padded to 256; read back padded or not", async () => {
  const senderId = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const content = dmContent({ kind: "message", messageId: "M1", text: "hey" }, { timestampMs: 1_800_000_000_123n, senderId });
  const bytes = fromBase64url(content.slice(9))!;
  assert.equal(bytes.length, 256);
  assert.deepEqual([...bytes.subarray(0, 3)], [1, 0x11, 7]);
  assert.equal(bytes[11], 0, "no flags: no recipient, no signature, not compressed");
  assert.deepEqual(bytes.subarray(14, 22), senderId);
  const p = await decodePacket(bytes);
  assert.ok(p);
  assert.equal(p.timestampMs, 1_800_000_000_123n);
  assert.deepEqual([...p.payload], [0x01, 0x00, 2, 77, 49, 0x01, 3, 104, 101, 121]);
  assert.deepEqual(await readDmContent(content), { kind: "message", messageId: "M1", text: "hey" });
  assert.deepEqual(await readDmContent(dmContent({ kind: "delivered", messageId: "M1" })), { kind: "delivered", messageId: "M1" });
  assert.deepEqual(await readDmContent(dmContent({ kind: "read", messageId: "M1" })), { kind: "read", messageId: "M1" });
});

test("a compressed packet (BitChat deflates a payload of 100 bytes or more): read through raw DEFLATE, bounded", async () => {
  const { deflateRawSync } = await import("node:zlib");
  const tlv = privateMessageTlv("A".repeat(36), "la ".repeat(80))!;
  const payload = Uint8Array.from([0x01, ...tlv]);
  const deflated = new Uint8Array(deflateRawSync(payload));
  const body = new Uint8Array(2 + deflated.length);
  body[0] = payload.length >> 8;
  body[1] = payload.length & 0xff;
  body.set(deflated, 2);
  const packet = encodePacket({ type: 0x11, ttl: 7, timestampMs: 1n, senderId: new Uint8Array(8), payload: body });
  packet[11] = 0x04; // the compressed flag
  const content = `bitchat1:${base64url(packet)}`;
  assert.deepEqual(await readDmContent(content, nodeInflate), { kind: "message", messageId: "A".repeat(36), text: "la ".repeat(80) });
  assert.deepEqual(await readDmContent(content), { kind: "message", messageId: "A".repeat(36), text: "la ".repeat(80) }, "the web's DecompressionStream too");
  // A packet that claims more than it inflates to, or an impossible ratio: nothing.
  const lying = packet.slice();
  lying[22] = 0x0f;
  assert.equal(await readDmContent(`bitchat1:${base64url(lying)}`, nodeInflate), null);
});

test("the TLV: 255 bytes at most each (BitChat can't send more); malformed is nothing", () => {
  assert.equal(privateMessageTlv("id", "é".repeat(128)), null, "256 bytes of UTF-8");
  assert.ok(privateMessageTlv("id", "x".repeat(255)));
  assert.deepEqual(readPrivateMessageTlv(privateMessageTlv("id", "x")!), { messageId: "id", text: "x" });
  assert.equal(readPrivateMessageTlv(Uint8Array.from([0x02, 0])), null, "an unknown type");
  assert.equal(readPrivateMessageTlv(Uint8Array.from([0x00, 5, 1])), null, "a length past the end");
  assert.equal(readPrivateMessageTlv(Uint8Array.from([0x00, 1, 65])), null, "no content");
});

test("the rumor's time must be plausible (isPlausibleRumorTimestamp): a day back, 15 minutes ahead", () => {
  const now = 1_800_000_000;
  assert.ok(plausibleRumorTime(now, now));
  assert.ok(plausibleRumorTime(now - 86_400 - 900, now));
  assert.ok(!plausibleRumorTime(now - 86_400 - 901, now));
  assert.ok(plausibleRumorTime(now + 900, now));
  assert.ok(!plausibleRumorTime(now + 901, now));
});

test("a recipient is an x-only key on the curve", () => {
  assert.ok(isRecipient(publicKeyHex(key())));
  assert.ok(!isRecipient("f".repeat(64)), "x past the field: no point");
  assert.ok(!isRecipient("ABC"));
  assert.ok(!isRecipient(undefined));
});
