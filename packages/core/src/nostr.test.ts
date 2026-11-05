// ZeroFee Chat's events against BitChat's: its own test vectors (bitchatTests/Nostr/NostrPoWTests.swift and the signed
// fixtures in bitchatTests/Nostr/Fixtures, public domain), and real kind-20000 events BitChat apps sent to the
// directory relays (read only, testing/nostr-vectors.json). Our serializer must give their ids byte for byte, our
// verifier must accept their signatures, and our events must carry the same tags in the same order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import {
  CHAT_PATH, GEOHASH_MESSAGE, GEOHASH_PRESENCE, chatFields, chatSeed, eventHash, leadingZeroBits, mineNonce, placeKey, publicKeyHex,
  serialize, signChat, validatedDifficulty, verifyEvent, POW_FALLBACK_MS, POW_TIME_CAP_MS, type NostrEvent,
} from "./nostr.ts";
import { ProblemError } from "./problem.ts";

const vectors = JSON.parse(readFileSync(new URL("./testing/nostr-vectors.json", import.meta.url), "utf8")) as { repo: Record<string, NostrEvent>; live: NostrEvent[] };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (...b: number[]) => Uint8Array.from(b);

test("NIP-13 leading zero bits: BitChat's vectors (NostrPoWTests leadingZeroBitsVectors, ExactByteBoundaries, NIP-13 example)", () => {
  assert.equal(leadingZeroBits(new Uint8Array()), 0);
  assert.equal(leadingZeroBits(bytes(0x80)), 0);
  assert.equal(leadingZeroBits(bytes(0xff, 0x00)), 0);
  assert.equal(leadingZeroBits(bytes(0x40)), 1);
  assert.equal(leadingZeroBits(bytes(0x01)), 7);
  assert.equal(leadingZeroBits(bytes(0x00, 0x00, 0xf0)), 16);
  assert.equal(leadingZeroBits(new Uint8Array(32)), 256);
  assert.equal(leadingZeroBits(bytes(0x00, 0xff)), 8);
  assert.equal(leadingZeroBits(bytes(0x00, 0x80)), 8);
  assert.equal(leadingZeroBits(bytes(0x00, 0x7f)), 9);
  assert.equal(leadingZeroBits(bytes(0x00, 0x01)), 15);
  assert.equal(leadingZeroBits(bytes(0x00, 0x00, 0x01)), 23);
  const nip13 = "000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d";
  assert.equal(leadingZeroBits(Uint8Array.from(nip13.match(/../g)!, (h) => parseInt(h, 16))), 36);
});

test("NIP-13 commitment: only the committed target counts, and only when met (NostrPoWTests commitment semantics)", () => {
  const id16 = "0000f000" + "ab".repeat(28);
  assert.equal(validatedDifficulty(id16, [["g", "u4pruy"], ["nonce", "12345", "8"]]), 8);
  assert.equal(validatedDifficulty(id16, [["nonce", "12345", "24"]]), 0);
  assert.equal(validatedDifficulty(id16, [["nonce", "12345", "16"]]), 16);
  assert.equal(validatedDifficulty(id16, [["g", "u4pruy"]]), 0);
  assert.equal(validatedDifficulty(id16, [["nonce", "12345"]]), 0);
  for (const bad of ["high", "0", "-4", "400"]) assert.equal(validatedDifficulty(id16, [["nonce", "1", bad]]), 0, bad);
  assert.equal(validatedDifficulty("not-hex", [["nonce", "1", "8"]]), 0);
});

test("mining: BitChat's own inputs (minedNonceTagMeetsCommittedDifficulty, miningSurvivesContentThatNeedsEscaping)", () => {
  const base = { pubkey: "a".repeat(64), created_at: 1_700_000_000, kind: 20000, tags: [["g", "u4pruydq"], ["n", "tester"]], content: "hello pow" };
  const tag = mineNonce(base, { targetBits: 8 });
  assert.equal(tag.length, 3);
  assert.equal(tag[0], "nonce");
  assert.match(tag[1]!, /^[0-9a-f]{16}$/, "16 lower-case hex, as BitChat writes it");
  assert.equal(tag[2], "8");
  const id = eventHash({ ...base, tags: [...base.tags, tag] });
  assert.ok(leadingZeroBits(id) >= 8);
  assert.equal(validatedDifficulty(hex(id), [...base.tags, tag]), 8);

  const escaping = { pubkey: "b".repeat(64), created_at: 1_700_000_123, kind: 20000, tags: [["g", "9q8yy"]], content: "she said \"hi\"\n0000000000000000 / ffffffffffffffff 😀\\" };
  const t2 = mineNonce(escaping, { targetBits: 4 });
  assert.ok(leadingZeroBits(eventHash({ ...escaping, tags: [...escaping.tags, t2] })) >= 4);
  // The slash is never escaped (BitChat serializes withoutEscapingSlashes, NIP-01 too).
  assert.ok(serialize(escaping).includes(" / "));
});

test("mining that runs out of time steps the target down and stays honest (cancelledMiningStillProducesHonestCommitment)", () => {
  let t = 0;
  const base = { pubkey: "c".repeat(64), created_at: 1_700_000_456, kind: 20000, tags: [["g", "gbsuv"]], content: "expedited" };
  const tag = mineNonce(base, { targetBits: 240, now: () => (t += 50) });
  const committed = Number(tag[2]);
  assert.ok(committed >= 0 && committed < 240);
  if (committed > 0) assert.ok(leadingZeroBits(eventHash({ ...base, tags: [...base.tags, tag] })) >= committed);
});

test("BitChat's signed fixtures (iOS and Android, kind 1059): our serializer gives their ids, our verifier takes their signatures", () => {
  for (const [name, e] of Object.entries(vectors.repo)) {
    assert.equal(hex(eventHash(e)), e.id, `${name}: id`);
    assert.ok(verifyEvent(e), `${name}: signature`);
    assert.ok(!verifyEvent({ ...e, content: e.content + "x" }), `${name}: a changed content no longer verifies`);
    assert.ok(!verifyEvent({ ...e, sig: e.sig.replace(/^./, (c) => (c === "0" ? "1" : "0")) }), `${name}: a changed signature fails`);
  }
});

test("real BitChat channel events from the relays: ids match byte for byte (emoji, new lines, CJK, an invisible nickname)", () => {
  assert.ok(vectors.live.length >= 7);
  for (const e of vectors.live) {
    assert.equal(e.kind, GEOHASH_MESSAGE);
    assert.equal(hex(eventHash(e)), e.id, e.content);
    assert.ok(verifyEvent(e), `signature: ${e.content}`);
  }
});

test("our message has BitChat iOS's exact shape: g, n, t, then a 16-hex nonce committed at 8 bits; verified and mined", () => {
  // BitChat iOS's own events on the relays (createMinedEphemeralGeohashEvent): ["g"], ["n"], ["t","teleport"], ["nonce", 16 hex, "8"].
  const theirs = vectors.live.find((e) => e.tags.some((t) => t[0] === "t") && e.tags.at(-1)?.[0] === "nonce" && e.tags.at(-1)?.[1]?.length === 16)!;
  assert.ok(theirs, "a BitChat iOS teleport message is among the vectors");
  const seed = sha256(new TextEncoder().encode("zerofee chat test seed"));
  const ours = signChat(seed, { geohash: "dr", kind: GEOHASH_MESSAGE, content: "Burger", nickname: "anon5783", teleport: true }, { nowSeconds: theirs.created_at });
  assert.deepEqual(ours.tags.map((t) => t[0]), theirs.tags.map((t) => t[0]));
  assert.deepEqual(ours.tags.slice(0, -1), theirs.tags.slice(0, -1), "same g, n and t tags for the same place, name and teleport");
  assert.equal(ours.tags.at(-1)![2], "8");
  assert.match(ours.tags.at(-1)![1]!, /^[0-9a-f]{16}$/);
  assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort());
  assert.ok(verifyEvent(ours));
  assert.equal(validatedDifficulty(ours.id, ours.tags), 8);
  assert.equal(ours.created_at, theirs.created_at);
});

test("place keys: BitChat's derivation, deterministic, one per place, and the seed is not a place's key", () => {
  const seed = sha256(new TextEncoder().encode("seed"));
  const k = placeKey(seed, "u4pruy");
  // HMAC-SHA256(seed, "u4pruy" ‖ 00000000), as NostrIdentityBridge.deriveIdentity's first candidate.
  assert.equal(hex(k), hex(hmac(sha256, seed, Uint8Array.from([...new TextEncoder().encode("u4pruy"), 0, 0, 0, 0]))));
  assert.equal(hex(placeKey(seed, "u4pruy")), hex(k));
  assert.notEqual(publicKeyHex(placeKey(seed, "u4pruz")), publicKeyHex(k));
  assert.equal(publicKeyHex(k), hex(schnorr.getPublicKey(k)));
});

test("the Chat seed has its own path under the hot root, apart from every wallet's", () => {
  assert.equal(CHAT_PATH, "m/44'/1237'/16'/0/0");
  const root = sha256(new TextEncoder().encode("root"));
  const a = chatSeed(root);
  assert.equal(a.length, 32);
  assert.equal(hex(chatSeed(root)), hex(a));
  assert.notEqual(hex(chatSeed(sha256(new TextEncoder().encode("other")))), hex(a));
});

test("the core signs only a place's message or presence, built from fields: never an app's tags, kind or time", () => {
  const refused = (p: Record<string, unknown>) => assert.throws(() => chatFields(p, 1_800_000_000), (e: unknown) => e instanceof ProblemError && e.problem.code === "security.request.invalid", JSON.stringify(p));
  refused({ geohash: "u4pruy", kind: 1, content: "hi" });
  refused({ geohash: "u4pruy", kind: 4, content: "hi" });
  refused({ geohash: "u4pruy", kind: 1059, content: "hi" });
  refused({ geohash: "U4PRUY", kind: GEOHASH_MESSAGE, content: "hi" });
  refused({ geohash: "a", kind: GEOHASH_MESSAGE, content: "hi" });
  refused({ geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "" });
  refused({ geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "x".repeat(2001) });
  refused({ geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "hi", nickname: "a\u202eb" });
  refused({ geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "hi", nickname: "x".repeat(33) });
  refused({ geohash: "u4pruy", kind: GEOHASH_PRESENCE, content: "hi" });
  const f = chatFields({ geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "hi", tags: [["p", "x"]], created_at: 1, nickname: " bob " }, 1_800_000_000.7);
  assert.deepEqual(f.fields.tags, [["g", "u4pruy"], ["n", "bob"]], "an app's own tags are ignored");
  assert.equal(f.fields.created_at, 1_800_000_000, "the core's clock, never the app's");
  const presence = signChat(sha256(new Uint8Array(1)), { geohash: "u4pr", kind: GEOHASH_PRESENCE, content: "" });
  assert.deepEqual(presence.tags, [["g", "u4pr"]]);
  assert.equal(presence.content, "");
  assert.ok(verifyEvent(presence));
});

test("verifyEvent refuses what BitChat refuses: too many tags, an oversized value, a wrong id, garbage", () => {
  const e = signChat(sha256(new Uint8Array(2)), { geohash: "u4pruy", kind: GEOHASH_MESSAGE, content: "hello" }, { mine: { targetBits: 0 } });
  assert.ok(verifyEvent(e));
  assert.ok(!verifyEvent({ ...e, id: "0".repeat(64) }));
  assert.ok(!verifyEvent({ ...e, tags: Array.from({ length: 65 }, () => ["x"]) }));
  assert.ok(!verifyEvent({ ...e, tags: [["g", "x".repeat(1025)]] }));
  for (const junk of [null, 1, "x", [], { ...e, kind: "20000" }, { ...e, created_at: 1.5 }]) assert.ok(!verifyEvent(junk));
});

test("mining is bounded on the core's thread (security review 2 Nov, Low): at most 250 ms at the target, 25 ms a step", () => {
  let t = 0;
  const now = () => (t += 1);
  const base = { pubkey: "d".repeat(64), created_at: 1_700_000_789, kind: 20000, tags: [["g", "u0qj"]], content: "x".repeat(2000) };
  const tag = mineNonce(base, { targetBits: 64, now });
  // 64 can't be met: 250 ms there, then 32, 16, 8, … 25 ms each until one is (the clock is read every 64 tries).
  assert.ok(t <= POW_TIME_CAP_MS + 6 * POW_FALLBACK_MS + 8, `busy ${t} ms`);
  assert.ok(Number(tag[2]) < 64);
});
