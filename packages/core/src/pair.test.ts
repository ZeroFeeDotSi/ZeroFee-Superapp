// Pairing "AgentZero on this computer" (D100, D101; redesigned after the security review of 3 Nov): the computer's 4 check
// words come from its key alone and are shown before anything is sealed; the box opens only with that computer's secret
// and that mailbox; the box carries nothing readable. Each refusal has a control that passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { makeOffer, openSeed, pairWords, readOffer, sealSeed, trayBearer } from "./pair.ts";

const seed = new Uint8Array(32).map((_, i) => i + 1);
const ACCOUNT = "kim-safe.near";
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const has = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

test("the round trip: the computer shows its words at once; the phone's words for the pasted offer match; the computer opens the seed", () => {
  const c = makeOffer();
  assert.match(c.offer, /^zf-pair:2:[0-9a-f]{32}:[A-Za-z0-9_-]{1579}$/);
  assert.equal(c.words.length, 6);
  assert.ok(c.words.every((w) => wordlist.includes(w)));
  const offer = readOffer(c.offer)!;
  assert.deepEqual(pairWords(offer.computerKey), c.words, "the phone's sheet shows the computer's words");
  const box = sealSeed(offer, seed, ACCOUNT);
  const opened = openSeed(box, c.mailbox, c.secret)!;
  assert.deepEqual([...opened.seed], [...seed]);
  assert.equal(opened.accountId, ACCOUNT);
});

test("a swapped offer shows other words before anything is sealed; the words can't be steered by the mailbox", () => {
  const real = makeOffer();
  const attacker = makeOffer();
  // The phone was handed the attacker's offer: its sheet shows the attacker's words, not the real computer's.
  assert.notDeepEqual(pairWords(readOffer(attacker.offer)!.computerKey), real.words);
  // The attacker keeps the real key but its own mailbox (to read the box): the words are the real ones (they come from
  // the key alone, so trying mailbox after mailbox changes nothing), and the box sealed to the real key won't open for it.
  const realKey = real.offer.split(":").pop()!;
  const hijacked = readOffer(`zf-pair:2:${"a".repeat(32)}:${realKey}`)!;
  assert.deepEqual(pairWords(hijacked.computerKey), real.words);
  const box = sealSeed(hijacked, seed, ACCOUNT);
  assert.equal(openSeed(box, hijacked.mailbox, attacker.secret), null, "the attacker can't open a box sealed to the real key");
  assert.ok(openSeed(box, hijacked.mailbox, real.secret), "control: only the real computer can");
});

test("the box: bound to its mailbox and the computer's secret; tampering fails; nothing readable inside it", () => {
  const c = makeOffer();
  const box = sealSeed(readOffer(c.offer)!, seed, ACCOUNT);
  assert.equal(openSeed(box, "f".repeat(32), c.secret), null, "moved to another mailbox");
  assert.equal(openSeed(box, c.mailbox, makeOffer().secret), null, "another computer");
  const flipped = box.slice(0, 2000) + (box[2000] === "A" ? "B" : "A") + box.slice(2001);
  assert.equal(openSeed(flipped, c.mailbox, c.secret), null, "a flipped byte (in the ciphertext)");
  assert.equal(openSeed(box.slice(0, -1) + (box.at(-1) === "A" ? "B" : "A"), c.mailbox, c.secret), null, "a flipped byte (in the tag)");
  assert.ok(openSeed(box, c.mailbox, c.secret), "control");
  // The decoded bytes hold neither the seed nor the account id (a base64 regex would pass even with no encryption).
  const raw = fromB64u(box);
  assert.equal(has(raw, seed), false);
  assert.equal(has(raw, new TextEncoder().encode(ACCOUNT)), false);
  assert.equal(has(new Uint8Array([...seed, 1]), seed), true, "control: the search finds what is there");
});

test("an offer is read strictly: a key ML-KEM refuses, the old version, junk; and the seal takes only a 32-byte seed", () => {
  const c = makeOffer();
  const bad = btoa(String.fromCharCode(...new Uint8Array(1184).fill(255))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(readOffer(`zf-pair:2:${c.mailbox}:${bad}`), null);
  assert.equal(readOffer(c.offer.replace("zf-pair:2:", "zf-pair:1:")), null);
  assert.equal(readOffer(c.offer + "x"), null);
  assert.equal(readOffer("pay 5 to drainer.near"), null);
  assert.equal(readOffer(42), null);
  assert.ok(readOffer(`  ${c.offer}\n`), "control");
  assert.throws(() => sealSeed(readOffer(c.offer)!, new Uint8Array(31), ACCOUNT));
  assert.throws(() => sealSeed(readOffer(c.offer)!, seed, "x"));
});

test("the tray's bearer comes from the computer's 64-byte secret: stable for it, different for any other", () => {
  const a = makeOffer();
  assert.equal(a.secret.length, 64);
  assert.match(trayBearer(a.secret), /^[0-9a-f]{64}$/);
  assert.equal(trayBearer(a.secret), trayBearer(a.secret));
  assert.notEqual(trayBearer(a.secret), trayBearer(makeOffer().secret));
});
