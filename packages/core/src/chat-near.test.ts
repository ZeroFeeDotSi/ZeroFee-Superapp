// J3 part 2 (NEARchat): the Chat name (an account's NEP-413 note naming one chat key), NEAR rooms' keys and events, and
// the rule for which of an account's keys may speak for it. Each check has a control that fails without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { GEOHASH_MESSAGE, placeKey, publicKeyHex, verifyEvent, type NostrEvent } from "./nostr.ts";
import { SoftwareKey } from "./device-key.ts";
import { base58 } from "./sol/bytes.ts";
import { nep413Hash } from "./private-pocket.ts";
import { CHAT_NAME_D, CHAT_NAME_KIND, CHAT_NAME_RECIPIENT, ROOM_MESSAGE, chatKeyAsk, chatNameHash, chatNameMessage, isRoomId, nameEvent, nameUntil, namedPlaceKey, readNameEvent, recordSigned, roomFor, roomKey, type ChatNameRecord } from "./chat-near.ts";
import { daosOf, isDaoName, readPolicy, readProfile, rolesOf, speaksForAccount } from "./chat-reads.ts";
import type { ChainKey } from "./chain.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const problem = (r: BridgeResult<unknown>): string => ("problem" in r ? r.problem.code : "ok");
const ACCOUNT = "zf-0123456789.near";
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const seed = new Uint8Array(32).fill(9);
const NOW = Date.parse("2026-11-02T10:00:00.000Z");

/** A record signed by an ed25519 key for `chatKey`. */
function edRecord(account: string, chatKey: string, secret = new Uint8Array(32).fill(3), until = nameUntil(NOW)): ChatNameRecord {
  const nonce = b64(new Uint8Array(32).fill(5));
  const sig = ed25519.sign(chatNameHash(account, chatKey, until, nonce), secret);
  return { v: 1, account, publicKey: `ed25519:${base58(ed25519.getPublicKey(secret))}`, signature: `ed25519:${base58(sig)}`, nonce, until };
}

test("the note is NEP-413 over exactly four lines for chat.zerofee.si; another recipient or line is another hash", () => {
  const key = "a".repeat(64);
  const until = "2027-01-01T00:00:00.000Z";
  assert.equal(chatNameMessage(ACCOUNT, key, until), `ZeroFee Chat name\nAccount: ${ACCOUNT}\nChat key: ${key}\nUntil: ${until}`);
  const nonce = b64(new Uint8Array(32).fill(1));
  const h = chatNameHash(ACCOUNT, key, until, nonce);
  assert.deepEqual(h, nep413Hash({ message: chatNameMessage(ACCOUNT, key, until), nonce, recipient: CHAT_NAME_RECIPIENT }));
  // control: the alerts relay's recipient, or the same lines with one more, never give this hash
  assert.notDeepEqual(h, nep413Hash({ message: chatNameMessage(ACCOUNT, key, until), nonce, recipient: "quotes-seven-gamma.vercel.app" }));
  assert.notDeepEqual(h, nep413Hash({ message: `${chatNameMessage(ACCOUNT, key, until)}\n`, nonce, recipient: CHAT_NAME_RECIPIENT }));
});

test("a record counts only for the chat key its note names, in date, signed by the key it carries (ed25519 and ML-DSA-65)", async () => {
  const chatKey = publicKeyHex(roomKey(seed, ACCOUNT));
  const r = edRecord(ACCOUNT, chatKey);
  assert.equal(recordSigned(r, chatKey, NOW), true);
  assert.equal(recordSigned(r, publicKeyHex(roomKey(seed, "someone.near")), NOW), false, "another chat key: no");
  assert.equal(recordSigned({ ...r, account: "alice.near" }, chatKey, NOW), false, "another account: no");
  assert.equal(recordSigned(r, chatKey, Date.parse(r.until) + 1), false, "past its Until: no");
  assert.equal(recordSigned({ ...r, until: new Date(NOW + 100 * 86_400_000).toISOString() }, chatKey, NOW), false, "Until over 90 days: no");
  const pq = SoftwareKey.generate();
  const nonce = b64(new Uint8Array(32).fill(8));
  const until = nameUntil(NOW);
  const sig = await pq.signHash(chatNameHash(ACCOUNT, chatKey, until, nonce));
  const rec: ChatNameRecord = { v: 1, account: ACCOUNT, publicKey: pq.publicKey, signature: `ml-dsa-65:${base58(sig)}`, nonce, until };
  assert.equal(recordSigned(rec, chatKey, NOW), true, "an ML-DSA-65 key's note");
  assert.equal(recordSigned({ ...rec, nonce: b64(new Uint8Array(32).fill(9)) }, chatKey, NOW), false, "another nonce: no");
});

test("a reader takes a record only with exactly the d tag, signed in the last 30 days, never from the future", () => {
  const secret = roomKey(seed, ACCOUNT);
  const chatKey = publicKeyHex(secret);
  const r = edRecord(ACCOUNT, chatKey);
  const e = nameEvent(secret, r, NOW / 1000);
  assert.equal(verifyEvent(e), true);
  assert.equal(readNameEvent(e, NOW)?.record?.account, ACCOUNT);
  assert.equal(readNameEvent(nameEvent(secret, null, NOW / 1000), NOW)?.record, null, "empty: the name taken back");
  assert.equal(readNameEvent(nameEvent(secret, r, NOW / 1000 - 31 * 86_400), NOW), undefined, "older than 30 days: no");
  assert.equal(readNameEvent(nameEvent(secret, r, NOW / 1000 + 3600), NOW), undefined, "an hour ahead: no");
  assert.equal(readNameEvent({ ...e, tags: [["d", CHAT_NAME_D], ["p", "x"]] } as NostrEvent, NOW), undefined, "another tag: no");
  assert.equal(readNameEvent({ ...e, content: JSON.stringify({ ...r, account: "alice.near" }) } as NostrEvent, NOW), undefined, "a forged account: no");
  assert.equal(e.kind, CHAT_NAME_KIND);
});

test("keys: a room key per account, a named key per account and place, never BitChat's anonymous place key", () => {
  const anon = publicKeyHex(placeKey(seed, "u0qj"));
  const named = publicKeyHex(namedPlaceKey(seed, ACCOUNT, "u0qj"));
  const room = publicKeyHex(roomKey(seed, ACCOUNT));
  assert.equal(new Set([anon, named, room, publicKeyHex(roomKey(seed, "other.near")), publicKeyHex(namedPlaceKey(seed, "other.near", "u0qj"))]).size, 5);
  assert.throws(() => chatKeyAsk({ room: "near:a.near", geohash: "u0qj" }), /security.request.invalid/, "both: refused (M4)");
  assert.throws(() => chatKeyAsk({}), /security.request.invalid/, "neither: refused");
  
  assert.doesNotThrow(() => chatKeyAsk({ geohash: "u0qjd", named: true }), "5 letters: a city");
  assert.throws(() => chatKeyAsk({ geohash: "u0qjdx", named: true }), /security.request.invalid/, "6 letters: too close (M7)");
});

test("rooms: near:<account> and token:<COIN> only; what a person types becomes one", () => {
  assert.equal(roomFor("alice.near"), "near:alice.near");
  assert.equal(roomFor(" Marketing.Sputnik-DAO.near "), "near:marketing.sputnik-dao.near");
  assert.equal(roomFor("usdc"), "token:USDC");
  assert.equal(roomFor("$near"), "token:NEAR");
  assert.equal(roomFor("not a name"), null);
  assert.equal(roomFor("bad..near"), null);
  assert.equal(isRoomId("near:alice.near"), true);
  assert.equal(isRoomId("near:Alice.near"), false);
  assert.equal(isRoomId("geo:u0qj"), false);
});

test("the core: a room message is kind 9 with only ['h', room], by the room key; a place's stays BitChat's", async () => {
  const vault = new MemoryVault();
  await vault.put("state", new TextEncoder().encode(JSON.stringify({ accountId: ACCOUNT, stage: "ready", recoveryIn: true })));
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  await (core as unknown as { deviceKeys: { make(): Promise<unknown> } }).deviceKeys.make();
  core.on("approval.needed", (w: { id: string }) => void core.call("approval.answer", { id: w.id, approve: true }));
  // No name yet: the core signs no room message (diff review L1); the control after showing it passes.
  assert.equal(problem(await core.call("nostr.sign", { app: "chat", room: "near:marketing.sputnik-dao.near", kind: ROOM_MESSAGE, content: "too early" })), "security.request.not-allowed");
  ok(await core.call("nostr.bind", { app: "chat", room: true }));
  const room = ok(await core.call<NostrEvent>("nostr.sign", { app: "chat", room: "near:marketing.sputnik-dao.near", kind: ROOM_MESSAGE, content: "hello room" }));
  assert.equal(room.kind, ROOM_MESSAGE);
  assert.deepEqual(room.tags, [["h", "near:marketing.sputnik-dao.near"]]);
  assert.equal(verifyEvent(room), true);
  const roomPub = ok(await core.call<{ pubkey: string }>("nostr.publicKey", { app: "chat", room: true })).pubkey;
  assert.equal(room.pubkey, roomPub);
  const place = ok(await core.call<NostrEvent>("nostr.sign", { app: "chat", geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "hi" }));
  assert.notEqual(place.pubkey, roomPub);
  assert.equal(problem(await core.call("nostr.sign", { app: "chat", room: "near:a.near", geohash: "u0qj", kind: ROOM_MESSAGE, content: "x" })), "security.request.invalid");
  assert.equal(problem(await core.call("nostr.sign", { app: "chat", room: "near:a.near", kind: ROOM_MESSAGE, content: "x", nickname: "alice.near" })), "security.request.invalid", "no nickname in a room");
  assert.equal(problem(await core.call("nostr.seal", { app: "chat", room: "near:a.near", to: "a".repeat(64), kind: "message", text: "x" })), "security.request.invalid", "no private messages in rooms");
  assert.equal(problem(await core.call("nostr.publicKey", { app: "trade", room: true })), "security.method.unknown", "Chat only");
});

test("the core: bind shows its sheet, signs with the device key, and the record checks; no sheet, nothing signed", async () => {
  const vault = new MemoryVault();
  await vault.put("state", new TextEncoder().encode(JSON.stringify({ accountId: ACCOUNT, stage: "ready", recoveryIn: true })));
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  // the device key (the demo core's software key) must exist: made as for an account
  const made = await (core as unknown as { deviceKeys: { make(): Promise<{ publicKey: string }> } }).deviceKeys.make();
  const sheets: { id: string; words: { title: string; lines: string[] } }[] = [];
  core.on("approval.needed", (w: { id: string; words: { title: string; lines: string[] } }) => {
    sheets.push(w);
    void core.call("approval.answer", { id: w.id, approve: sheets.length !== 2 });
  });
  const bound = ok(await core.call<{ event: NostrEvent }>("nostr.bind", { app: "chat", room: true }));
  assert.equal(sheets[0]!.words.title, "Use your NEAR account in Chat");
  assert.match(sheets[0]!.words.lines.join(" "), new RegExp(`see you as ${ACCOUNT.replace(/\./g, "\\.")}`));
  const read = readNameEvent(bound.event);
  assert.equal(read?.record?.account, ACCOUNT);
  assert.equal(read?.record?.publicKey, made.publicKey, "the account's own device key signed it");
  assert.equal(read?.chatKey, ok(await core.call<{ pubkey: string }>("nostr.publicKey", { app: "chat", room: true })).pubkey);
  // shown again without a sheet
  const again = ok(await core.call<{ event: NostrEvent } | null>("nostr.bound", { app: "chat", room: true }));
  assert.equal(readNameEvent(again!.event)?.record?.signature, read?.record?.signature);
  assert.equal(sheets.length, 1);
  // a named place: its own sheet; a "no" signs nothing
  const no = ok(await core.call<{ declined?: true }>("nostr.bind", { app: "chat", geohash: "u0qjd", named: true }));
  assert.equal(no.declined, true);
  assert.equal(ok(await core.call("nostr.bound", { app: "chat", geohash: "u0qjd", named: true })), null);
  // never on BitChat's anonymous key, never a room by name, never from another app
  assert.equal(problem(await core.call("nostr.bind", { app: "chat", geohash: "u0qjd" })), "security.request.invalid");
  assert.equal(problem(await core.call("nostr.bind", { app: "chat", room: "near:a.near" })), "security.request.invalid");
  assert.equal(problem(await core.call("nostr.bind", { app: "trade", room: true })), "security.method.unknown");
  // unbind: the empty record
  const off = ok(await core.call<{ event: NostrEvent }>("nostr.unbind", { app: "chat", room: true }));
  assert.equal(readNameEvent(off.event)?.record, null);
});

test("speaks for the account: full access or the device key; never a second device, guardian, recovery or agent key (H1)", () => {
  const fc = (methods: string[], receiverId = ACCOUNT): ChainKey => ({ handle: "x", nonce: 0n, permission: { kind: "function-call", receiverId, methods, allowanceYocto: null } });
  assert.equal(speaksForAccount(ACCOUNT, { handle: "x", nonce: 0n, permission: { kind: "full" } }), true);
  assert.equal(speaksForAccount(ACCOUNT, fc("execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade".split(","))), true, "the phone");
  assert.equal(speaksForAccount(ACCOUNT, fc("approve,decline,approve_recovery,refuse_recovery,refill_recovery_key".split(","))), false, "a second device or guardian");
  assert.equal(speaksForAccount(ACCOUNT, fc(["start_recovery", "finish_recovery"])), false, "the recovery key");
  assert.equal(speaksForAccount(ACCOUNT, fc(["agent_pay", "agent_convert", "run_order"])), false, "an agent's key");
  assert.equal(speaksForAccount(ACCOUNT, fc(["execute", "set_recovery_key"], "other.near")), false, "a key to another contract");
  assert.equal(speaksForAccount(ACCOUNT, fc(["execute", "set_recovery_key", "anything"])), false, "a list that only names execute: not the device key (diff review L4)");
  assert.equal(speaksForAccount(ACCOUNT, null), false);
});

test("DAOs: only Sputnik's names, Group roles only, names plain, caps; membership is get_policy's", async () => {
  assert.equal(isDaoName("marketing.sputnik-dao.near"), true);
  assert.equal(isDaoName("evil.near"), false, "any contract can answer get_policy: not a DAO");
  const p = readPolicy({ roles: [{ name: "Council ✓ ZeroFee team", kind: { Group: ["a.near", "b.near", "NOT AN ID"] } }, { name: "all", kind: "Everyone" }, { name: "council", kind: { Group: ["c.near"] } }] })!;
  assert.deepEqual(p.roles, [{ name: "Member", members: ["a.near", "b.near"] }, { name: "council", members: ["c.near"] }]);
  assert.deepEqual(rolesOf(p.roles, "a.near"), ["Member"]);
  assert.equal(readPolicy({ nope: 1 }), null);
  const view = async (id: string, m: string) => (m === "get_dao_list" ? ["x.sputnik-v2.testnet", "y.sputnik-v2.testnet", "evil.testnet"] : id === "x.sputnik-v2.testnet" ? { roles: [{ name: "council", kind: { Group: ["me.testnet"] } }] } : { roles: [] });
  const chain = { network: "testnet" as const, commonBlock: async () => ({ height: 1, hash: "h" }), accessKey: async () => null, view };
  assert.deepEqual(await daosOf(chain as never, "me.testnet"), [{ dao: "x.sputnik-v2.testnet", roles: ["council"] }]);
});

test("profiles: a plain display name only, never a picture url, never a NEAR-name shape", () => {
  const cid = "bafkreigjd5wcaqaxalsn73blee5jbx6bpambzpgoo5stui3mc6ebltno64";
  assert.deepEqual(readProfile({ "a.near": { profile: { name: "Illia ✓", image: { ipfs_cid: cid } } } }, "a.near"), { name: "Illia" });
  assert.deepEqual(readProfile({ "a.near": { profile: { name: "root.near", image: { url: "https://tracker.example/x.png" } } } }, "a.near"), {});
  assert.deepEqual(readProfile({ "a.near": { profile: { name: "x".repeat(20000) } } }, "a.near"), {}, "an answer over 16 KB: nothing");
});
