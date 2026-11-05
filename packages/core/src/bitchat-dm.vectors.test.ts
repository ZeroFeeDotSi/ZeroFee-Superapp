// Our port of BitChat's private messages against what BitChat's OWN Swift computes (bitchat-dm-vectors.json, written by
// tools/chat/bitchat-swift from permissionlesstech/bitchat 04995f68, public domain). Byte for byte wherever BitChat is
// deterministic: packets, TLV, XChaCha20-Poly1305, ECDH, HKDF, the v2 layer with a fixed nonce; and every envelope
// BitChat made opens to what BitChat says it holds, and every one BitChat refuses, we refuse.
//
// The one place our bytes differ on purpose: BitChat deflates a payload of 100 bytes or more (its raw DEFLATE, flag
// 0x04); we never compress what we send. For those vectors we check that we READ BitChat's compressed packet, and that
// our uncompressed packet of the same message reads the same; BitChat's own decoder reading ours is the harness's
// `open` mode (tools/chat/dm-interop.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  DmRefused, decodePacket, decryptV2, dmContent, encodePacket, encryptV2, envelopeKey, fromBase64url, openEnvelope, privateMessageTlv,
  readDmContent, readPrivateMessageTlv, sharedPoint, type Inflate,
} from "./bitchat-dm.ts";
import type { NostrEvent } from "./nostr.ts";

const V = JSON.parse(readFileSync(new URL("./bitchat-dm-vectors.json", import.meta.url), "utf8"));
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const nodeInflate: Inflate = async (d, size) => {
  try {
    return new Uint8Array(inflateRawSync(d, { maxOutputLength: size }));
  } catch {
    return null;
  }
};

test("the vectors are BitChat's, at the pinned commit", () => {
  assert.equal(V.bitchatCommit, "04995f68e470a18d1fc99f86fa326c2a87bab4f2");
  assert.ok(Object.keys(V.bitchatSourceSha256).some((p: string) => p.endsWith("NostrProtocol.swift")));
});

test("packets: ours equal BitChat's BinaryProtocol bytes exactly wherever BitChat doesn't compress; BitChat's compressed ones we read", async () => {
  let exact = 0;
  let compressed = 0;
  for (const p of V.packets) {
    const kind = p.kind === "privateMessage" ? "message" : p.kind === "delivered" ? "delivered" : "read";
    const payload = kind === "message" ? { kind, messageId: p.messageID, text: p.content } as const : { kind, messageId: p.messageID } as const;
    const ours = dmContent(payload, { timestampMs: BigInt(p.timestampMs), senderId: fromHex(p.senderIDHex) });
    const theirs = await readDmContent(p.bitchat1, nodeInflate);
    assert.deepEqual(theirs, payload, `${p.name}: we read BitChat's packet`);
    assert.deepEqual(await readDmContent(ours, nodeInflate), payload, `${p.name}: we read our own`);
    if (p.compressed) {
      compressed++;
      const decoded = await decodePacket(fromHex(p.packetHex), nodeInflate);
      assert.equal(hex(decoded!.payload), p.noisePayloadHex, `${p.name}: inflated to BitChat's payload`);
      assert.equal(decoded!.flags & 0x04, 0x04);
    } else {
      exact++;
      assert.equal(ours, p.bitchat1, `${p.name}: byte for byte`);
    }
  }
  assert.ok(exact >= 8 && compressed >= 5, `${exact} exact, ${compressed} compressed`);
});

test("TLV: encode byte for byte, nil where BitChat's is nil; decode as BitChat decodes (order, duplicates, trailing byte, bad UTF-8)", () => {
  for (const t of V.tlv) {
    const ours = privateMessageTlv(t.messageID, t.content);
    assert.equal(ours ? hex(ours) : null, t.tlvHex, t.name);
  }
  for (const t of V.tlvDecode) {
    const ours = readPrivateMessageTlv(fromHex(t.tlvHex));
    assert.deepEqual(ours, t.ok ? { messageId: t.messageID, text: t.content } : null, t.name);
  }
});

test("XChaCha20-Poly1305 (BitChat's HChaCha20 compat, the draft's A.3.1 vector first), ECDH, HKDF: byte for byte", () => {
  for (const x of V.xchacha) {
    const out = xchacha20poly1305(fromHex(x.keyHex), fromHex(x.nonceHex), x.aadHex ? fromHex(x.aadHex) : undefined).encrypt(fromHex(x.plaintextHex));
    assert.equal(hex(out), x.ciphertextHex + x.tagHex);
  }
  for (const e of V.ecdh) {
    assert.equal(hex(sharedPoint(fromHex(e.privateKeyHex), e.peerPublicKeyXonlyHex, "02")), e.sharedSecretHex, e.name);
    assert.equal(hex(sharedPoint(fromHex(e.privateKeyHex), e.peerPublicKeyXonlyHex, "03")), e.sharedSecretWithOddLiftHex, e.name);
  }
  for (const h of V.hkdf) {
    assert.equal(h.info, "nip44-v2");
    assert.equal(h.saltHex, "");
    assert.equal(hex(envelopeKey(fromHex(h.ikmHex))), h.keyHex);
  }
});

test("the v2 layer: our encrypt with BitChat's nonce gives BitChat's payload exactly; we open each the way BitChat does", () => {
  for (const e of V.encrypt) {
    const ours = encryptV2(e.plaintext, e.recipientPublicKeyHex, fromHex(e.senderPrivateKeyHex), fromHex(e.nonceHex));
    assert.equal(ours, e.payload, e.name);
    if (!e.bitchatDecryptAccepts) {
      // An empty plaintext: BitChat's decrypt wants more than nonce + tag (40 bytes), so neither side ever opens one.
      assert.throws(() => decryptV2(e.payload, e.senderPublicKeyHex, fromHex(e.recipientPrivateKeyHex)), DmRefused, e.name);
      continue;
    }
    assert.equal(decryptV2(e.payload, e.senderPublicKeyHex, fromHex(e.recipientPrivateKeyHex)), e.plaintext, `${e.name} (opens with the ${e.recipientDecryptOpensWithLift} lift)`);
  }
});

test("BitChat-made envelopes (PM, emoji, compressed, delivered, read, Android's inner p tag) open to what BitChat says", async () => {
  assert.ok(V.envelopes.length >= 6);
  for (const env of [...V.envelopes, ...V.fixtures]) {
    const opened = openEnvelope(fromHex(env.recipientPrivateKeyHex), env.event as NostrEvent);
    assert.equal(opened.content, env.expect.content, env.name);
    assert.equal(opened.from, env.expect.senderPubkey, env.name);
    assert.equal(opened.at, env.expect.timestamp, env.name);
    if (!env.expect.payloadType) continue;
    const read = await readDmContent(opened.content, nodeInflate);
    const kind = env.expect.payloadType === "privateMessage" ? "message" : env.expect.payloadType === "delivered" ? "delivered" : "read";
    assert.deepEqual(read, kind === "message" ? { kind, messageId: env.expect.messageID, text: env.expect.text } : { kind, messageId: env.expect.messageID }, env.name);
  }
});

test("every envelope BitChat refuses, we refuse (26 cases: outer, seal, rumor, ciphertext)", () => {
  assert.ok(V.rejects.length >= 26);
  for (const r of V.rejects) {
    assert.throws(() => openEnvelope(fromHex(r.recipientPrivateKeyHex), r.event), (e: unknown) => e instanceof DmRefused, r.name);
  }
});

test("our packet of each compressed vector's message is one BitChat accepts by its own rules: uncompressed, v1, padded or not", async () => {
  for (const p of V.packets.filter((x: { compressed: boolean }) => x.compressed)) {
    const ours = fromBase64url(dmContent({ kind: "message", messageId: p.messageID, text: p.content }, { timestampMs: BigInt(p.timestampMs), senderId: fromHex(p.senderIDHex) }).slice(9))!;
    const unpadded = fromHex(p.noisePayloadHex);
    const header = encodePacket({ type: 0x11, ttl: 7, timestampMs: BigInt(p.timestampMs), senderId: fromHex(p.senderIDHex), payload: unpadded });
    assert.deepEqual(ours, header, p.name);
    assert.equal(ours[11], 0, "no compressed flag");
  }
});
