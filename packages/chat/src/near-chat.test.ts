// J3 part 2 (NEARchat), Chat's side: a NEAR room hears only its own tagged messages; a name shows only once its record
// checks AND NEAR says the note's key is the account's; a nickname can't pose as a checked name; "request … from
// bob.near" and a request that names who is asked. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { GEOHASH_MESSAGE, publicKeyHex, signChat, type NostrEvent } from "@zerofee/core/nostr";
import { ROOM_MESSAGE, chatNameHash, nameEvent, nameUntil, roomKey, signRoom, type ChatNameRecord } from "@zerofee/core/chat-near";
import { base58 } from "@zerofee/core/sol/bytes";
import { RelayPool, type SocketLike } from "./pool.ts";
import { NameBook, accountWords, markWord, nickWords } from "./names.ts";
import { readRequest, requestText, whoOf } from "./messages.ts";
import { readAsk } from "./command.ts";
import { daoShort, isWhere, whereName } from "./rooms.ts";

const NOW = 1_793_000_000;
const seed = sha256(new TextEncoder().encode("room peer"));
const ACCOUNT = "alice.near";
const ROOM = "near:marketing.sputnik-dao.near";

function rig(listen: (p: RelayPool) => void) {
  const got: NostrEvent[] = [];
  const sent: string[] = [];
  const s: SocketLike = { readyState: 1, send: (d) => sent.push(d), close: () => {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const pool = new RelayPool(["wss://relay.example"], (e) => got.push(e), () => {}, () => s, () => NOW * 1000);
  listen(pool);
  s.onopen?.({});
  const hand = (e: unknown) => s.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", e]) });
  return { got, sent, hand, close: () => pool.close() };
}

test("a NEAR room asks for kind 9 with its ['h', room] and takes only those: never a place's, never another room's", () => {
  const { got, sent, hand, close } = rig((p) => p.room(ROOM));
  const req = JSON.parse(sent[0]!);
  assert.deepEqual([req[2].kinds, req[2]["#h"]], [[ROOM_MESSAGE], [ROOM]]);
  hand(signRoom(seed, ACCOUNT, { room: ROOM, kind: ROOM_MESSAGE, content: "control: this room" }, NOW));
  hand(signRoom(seed, ACCOUNT, { room: "near:other.near", kind: ROOM_MESSAGE, content: "another room" }, NOW));
  hand(signChat(seed, { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "a place" }, { nowSeconds: NOW, mine: { targetBits: 0 } }));
  assert.deepEqual(got.map((e) => e.content), ["control: this room"]);
  close();
});

test("names: only the keys asked for, kind 30078 with d = zerofee-chat-name", () => {
  const me = roomKey(seed, ACCOUNT);
  const other = roomKey(seed, "bob.near");
  const { got, sent, hand, close } = rig((p) => p.names([publicKeyHex(me)]));
  const req = JSON.parse(sent[0]!);
  assert.deepEqual([req[2].kinds, req[2].authors, req[2]["#d"]], [[30078], [publicKeyHex(me)], ["zerofee-chat-name"]]);
  hand(nameEvent(me, null, NOW));
  hand(nameEvent(other, null, NOW));
  assert.deepEqual(got.map((e) => e.pubkey), [publicKeyHex(me)], "a key not asked for: dropped");
  close();
});

function record(chatKey: string, account = ACCOUNT, secret = new Uint8Array(32).fill(4)): ChatNameRecord {
  const nonce = Buffer.from(new Uint8Array(32).fill(2)).toString("base64");
  const until = nameUntil(NOW * 1000);
  return { v: 1, account, publicKey: `ed25519:${base58(ed25519.getPublicKey(secret))}`, signature: `ed25519:${base58(ed25519.sign(chatNameHash(account, chatKey, until, nonce), secret))}`, nonce, until };
}

test("a name shows only when its record checks and NEAR says the key is the account's; asked once per account key", async () => {
  const key = roomKey(seed, ACCOUNT);
  const pub = publicKeyHex(key);
  const asked: Record<string, unknown>[] = [];
  let answer: boolean | null = true;
  const bridge = { call: async (_m: string, p?: Record<string, unknown>) => { asked.push(p!); return { ok: { onAccount: answer } } as never; } };
  let changes = 0;
  const book = new NameBook(bridge, () => changes++, () => NOW * 1000);
  book.see(nameEvent(key, record(pub), NOW));
  assert.equal(book.state(pub).status, "checking");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(book.state(pub), { status: "checked", account: ACCOUNT });
  assert.equal(book.account(pub), ACCOUNT);
  assert.equal(asked.length, 1);
  // a second chat key named by the same account key: NEAR isn't asked again (M6)
  const key2 = roomKey(seed, "x");
  book.see(nameEvent(key2, record(publicKeyHex(key2)), NOW));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked.length, 1);
  // NEAR says no (a guardian's key, a removed key): no name
  answer = false;
  const third = roomKey(seed, "y");
  const book2 = new NameBook(bridge, () => {}, () => NOW * 1000);
  book2.see(nameEvent(third, record(publicKeyHex(third), "carol.near", new Uint8Array(32).fill(6)), NOW));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(book2.account(publicKeyHex(third)), null);
  // a record for another chat key (copied onto this key): never read at all
  answer = true;
  const thief = roomKey(seed, "thief");
  book2.see(nameEvent(thief, record(pub), NOW));
  assert.equal(book2.state(publicKeyHex(thief)).status, "none");
  // taken back: the empty record, newer, ends it
  book.see(nameEvent(key, null, NOW + 10));
  assert.equal(book.state(pub).status, "none");
  assert.ok(changes > 0);
});

test("nicknames can't pose as a checked name: marks stripped, any dot (or a look-alike) says not checked", () => {
  const e = (n: string) => ({ tags: [["n", n]], pubkey: "a".repeat(60) + "beef" });
  assert.equal(whoOf(e("Ava")), "Ava#beef", "control");
  assert.equal(whoOf(e("alice.near ✓")), "alice.near#beef (not checked)");
  assert.equal(whoOf(e("alice․near")), "alice․near#beef (not checked)", "U+2024");
  assert.equal(nickWords("alice．near✓"), "alice．near (not checked)");
  assert.equal(nickWords("Ben"), "Ben");
});

test("account words: whole names (no middle cut for zf-…), only 64-hex implicit accounts shortened; the mark's word", () => {
  assert.equal(accountWords("zf-0123456789.near"), "zf-0123456789.near");
  assert.equal(accountWords("a".repeat(64)), "aaaaaaaa…aaaaaaaa");
  assert.equal(markWord("zf-sample424201.testnet"), "sample");
  assert.equal(markWord("zf-j3b-chat-mvz04nms.testnet"), "test network");
  assert.equal(markWord("alice.near"), null);
});

test("names as addresses: 'request 5 USDC from bob.near', and a request that says who is asked", () => {
  assert.deepEqual(readAsk("request 5 USDC from bob.near"), { ok: { amount: "5", coin: "USDC", from: "bob.near" } });
  assert.deepEqual(readAsk("request $5 from @Bob.near"), { ok: { amount: "5", coin: "USDC", from: "bob.near" } });
  assert.equal(readAsk("hello from Zurich"), null, "control: chat");
  assert.ok("problem" in readAsk("request 5 from bob.near")!);
  assert.ok("problem" in readAsk("request 5 USDC from bob")!);
  const r = { amount: "5", coin: "USDC", chain: "near", address: "alice.near", from: "bob.near" };
  assert.equal(requestText(r), "Request: 5 USDC on NEAR to alice.near from bob.near · ZeroFee Chat");
  assert.deepEqual(readRequest(requestText(r)), r);
  assert.deepEqual(readRequest("Request: 5 USDC on NEAR to alice.near · ZeroFee Chat"), { amount: "5", coin: "USDC", chain: "near", address: "alice.near" }, "control: no one asked");
});

test("rooms and places: where Chat can be, and their names", () => {
  assert.equal(isWhere("u0qj"), true);
  assert.equal(isWhere("near:alice.near"), true);
  assert.equal(isWhere("token:USDC"), true);
  assert.equal(isWhere("near:Alice"), false);
  assert.equal(whereName("near:marketing.sputnik-dao.near"), "marketing");
  assert.equal(whereName("near:alice.near"), "alice.near");
  assert.equal(whereName("token:USDC"), "USDC");
  assert.equal(daoShort("zf-chat-room.sputnik-v2.testnet"), "zf-chat-room");
});
