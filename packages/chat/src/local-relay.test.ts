// The sample-money pages' Chat never reaches a public relay (decision, 3 Nov): with the demo's switch set
// (relay-sockets.ts), a pool opens no WebSocket at all and a post still shows in its place for another pool on the page.
// Control: with the switch unset (the real app), the same pool opens a WebSocket to each relay it is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, signChat, type NostrEvent } from "@zerofee/core/nostr";
import { RelayPool } from "./pool.ts";
import { relaySockets } from "./relay-sockets.ts";
import { fits, localRelay } from "./local-relay.ts";

const PLACE = "eycs";
const RELAYS = ["wss://nos.lol", "wss://relay.primal.net"];
const seed = sha256(new TextEncoder().encode("local relay peer"));
const post = (content: string, geohash = PLACE): NostrEvent => signChat(seed, { geohash, kind: GEOHASH_MESSAGE, content }, { nowSeconds: Math.floor(Date.now() / 1000), mine: { targetBits: 0 } });
const settle = () => new Promise((r) => setTimeout(r, 20));

/** Counts every WebSocket the code under test opens (and opens none for real). */
function watchSockets() {
  const opened: string[] = [];
  const real = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = class {
    readyState = 0; onopen = null; onclose = null; onerror = null; onmessage = null;
    constructor(url: string) { opened.push(url); }
    send() {}
    close() {}
  };
  return { opened, restore: () => { (globalThis as { WebSocket?: unknown }).WebSocket = real; } };
}

test("with the demo's local relay, a place opens no WebSocket and a post reaches another pool on the page", async () => {
  const w = watchSockets();
  relaySockets.make = localRelay().make;
  try {
    const seenA: NostrEvent[] = [], seenB: NostrEvent[] = [];
    const a = new RelayPool(RELAYS, (e) => seenA.push(e));
    const b = new RelayPool(RELAYS, (e) => seenB.push(e));
    a.join(PLACE);
    b.join(PLACE);
    await settle();
    const r = await a.publish(post("hello from the demo"));
    await settle();
    assert.deepEqual(w.opened, [], "no socket to any relay host");
    assert.equal(r.ok, RELAYS.length, "every relay the pool knows says OK");
    assert.deepEqual(seenB.map((e) => e.content), ["hello from the demo"], "the other pool sees it once (one store behind every relay)");
    // a place joined later reads it back from the store; another place doesn't
    const c = new RelayPool(RELAYS, () => {}), seenC: NostrEvent[] = [];
    const d = new RelayPool(RELAYS, (e) => seenC.push(e));
    d.join(PLACE);
    c.join("u0qj");
    await settle();
    assert.deepEqual(seenC.map((e) => e.content), ["hello from the demo"]);
    for (const p of [a, b, c, d]) p.close();
  } finally {
    relaySockets.make = null;
    w.restore();
  }
});

test("control: with the switch unset (the real app), the pool opens a WebSocket to each relay", async () => {
  const w = watchSockets();
  try {
    const p = new RelayPool(RELAYS, () => {});
    p.join(PLACE);
    await settle();
    assert.deepEqual([...w.opened].sort(), [...RELAYS].sort());
    p.close();
  } finally {
    w.restore();
  }
});

test("the filter: kinds, #g, since and authors each keep an event out (control: the matching filter keeps it)", () => {
  const e = { id: "x", pubkey: "p1", kind: GEOHASH_MESSAGE, created_at: 100, tags: [["g", PLACE]] };
  assert.equal(fits(e, { kinds: [GEOHASH_MESSAGE], "#g": [PLACE], since: 50, authors: ["p1"] }), true, "control");
  assert.equal(fits(e, { kinds: [1] }), false);
  assert.equal(fits(e, { "#g": ["u0qj"] }), false);
  assert.equal(fits(e, { since: 101 }), false);
  assert.equal(fits(e, { authors: ["p2"] }), false);
});
