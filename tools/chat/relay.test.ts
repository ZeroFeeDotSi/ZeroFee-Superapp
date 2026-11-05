// Two ZeroFee Chat connections (RelayPool, the app's own) through the local relay (test T4): a message signed by the
// core's rules goes out from one and arrives at the other; a forged or tampered event is refused by the relay and, if a
// relay passed it on anyway, by the pool; another place's messages never show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, placeKey, publicKeyHex, signChat, type NostrEvent } from "../../packages/core/src/nostr.ts";
import { openChatDm, readDmContent, sealChatDm } from "../../packages/core/src/bitchat-dm.ts";
import { RelayPool, type SocketLike } from "../../packages/chat/src/pool.ts";
import { startRelay } from "./relay.ts";

const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const seed = (s: string) => sha256(new TextEncoder().encode(s));

test("two connections, one place: a message out of one arrives at the other, verified, once", async () => {
  const relay = await startRelay(0);
  const a: NostrEvent[] = [];
  const b: NostrEvent[] = [];
  const pa = new RelayPool([relay.url], (e) => a.push(e));
  const pb = new RelayPool([relay.url], (e) => b.push(e));
  try {
    pa.join("u0qj");
    pb.join("u0qj");
    await new Promise((r) => setTimeout(r, 300));
    const hello = signChat(seed("alice"), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "hello from A", nickname: "alice", teleport: true });
    assert.deepEqual(await pa.publish(hello), { ok: 1, of: 1 });
    await until(() => b.length === 1);
    assert.equal(b[0]!.content, "hello from A");
    const back = signChat(seed("bob"), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "hi A, it's B", nickname: "bob" });
    await pb.publish(back);
    await until(() => a.some((e) => e.id === back.id));
    // The same event twice is shown once.
    await pa.publish(hello);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(b.filter((e) => e.id === hello.id).length, 1);
    // Another place's message never shows here.
    await pa.publish(signChat(seed("alice"), { geohash: "u0qk", kind: GEOHASH_MESSAGE, content: "elsewhere" }));
    // A late joiner gets the last hour first.
    const c: NostrEvent[] = [];
    const pc = new RelayPool([relay.url], (e) => c.push(e));
    pc.join("u0qj");
    await until(() => c.length === 2);
    pc.close();
    assert.ok(!b.some((e) => e.content === "elsewhere"));
  } finally {
    pa.close();
    pb.close();
    await relay.close();
  }
});

test("private messages through the local relay (slice 2): sealed by one core, opened by the other, acked back", async () => {
  const relay = await startRelay(0);
  const [alice, bob] = [seed("alice dm"), seed("bob dm")];
  const keyIn = (s: Uint8Array) => publicKeyHex(placeKey(s, "u0qj"));
  const toBob: NostrEvent[] = [];
  const toAlice: NostrEvent[] = [];
  const pa = new RelayPool([relay.url], (e) => toAlice.push(e));
  const pb = new RelayPool([relay.url], (e) => toBob.push(e));
  try {
    pa.inbox(keyIn(alice));
    pb.inbox(keyIn(bob));
    await new Promise((r) => setTimeout(r, 300));
    const sent = sealChatDm(alice, { geohash: "u0qj", to: keyIn(bob), kind: "message", text: "hi bob, privately" });
    assert.equal((await pa.publish(sent.event)).ok, 1);
    await until(() => toBob.length === 1);
    assert.equal(toAlice.length, 0, "a wrap to Bob never reaches Alice's inbox");
    const opened = openChatDm(bob, { geohash: "u0qj", event: toBob[0] })!;
    assert.equal(opened.from, keyIn(alice));
    assert.deepEqual(await readDmContent(opened.content), { kind: "message", messageId: sent.messageId, text: "hi bob, privately" });
    const ack = sealChatDm(bob, { geohash: "u0qj", to: keyIn(alice), kind: "delivered", messageId: sent.messageId });
    await pb.publish(ack.event);
    await until(() => toAlice.length === 1);
    assert.deepEqual(await readDmContent(openChatDm(alice, { geohash: "u0qj", event: toAlice[0] })!.content), { kind: "delivered", messageId: sent.messageId });
    assert.equal(openChatDm(alice, { geohash: "u0qj", event: toBob[0] }), null, "Alice can't open Bob's");
  } finally {
    pa.close();
    pb.close();
    await relay.close();
  }
});

test("a tampered event: the relay says no, and a pool drops one a bad relay passes on", async () => {
  const relay = await startRelay(0);
  const pa = new RelayPool([relay.url], () => {});
  try {
    pa.join("u0qj");
    await new Promise((r) => setTimeout(r, 300));
    const e = signChat(seed("mallory"), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "send money to 0x0" });
    assert.deepEqual(await pa.publish({ ...e, content: "send money to 0xbad" }), { ok: 0, of: 1 });
    assert.equal(relay.events.length, 0);
  } finally {
    pa.close();
    await relay.close();
  }
  // A relay that passes anything on: the pool checks each event itself.
  const got: NostrEvent[] = [];
  let sock: SocketLike | null = null;
  const fake = (): SocketLike => {
    sock = { readyState: 1, send: () => {}, close: () => {}, onopen: null, onclose: null, onerror: null, onmessage: null };
    return sock;
  };
  const pool = new RelayPool(["wss://fake.example"], (x) => got.push(x), () => {}, fake);
  pool.join("u0qj");
  const good = signChat(seed("carol"), { geohash: "u0qj", kind: GEOHASH_MESSAGE, content: "real" });
  const s = sock as unknown as SocketLike;
  s.onopen?.({});
  s.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", { ...good, content: "forged" }]) });
  s.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", { ...good, kind: 1 }]) });
  s.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", signChat(seed("carol"), { geohash: "u0qk", kind: GEOHASH_MESSAGE, content: "other place" })]) });
  s.onmessage?.({ data: "x".repeat(300 * 1024) });
  s.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", good]) });
  pool.close();
  assert.deepEqual(got.map((x) => x.content), ["real"]);
});
