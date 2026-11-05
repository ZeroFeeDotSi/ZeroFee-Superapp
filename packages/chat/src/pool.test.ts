// What the relays hand over (security review 2 Nov, Medium): only this place's real messages, at a time no later than
// the clock allows, at a rate one relay can't use to stall the page. A control passes each time, so a drop is for the
// reason named and not for a broken event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, signChat, signEvent, type NostrEvent } from "@zerofee/core/nostr";
import { sealEnvelope } from "@zerofee/core/bitchat-dm";
import { MAX_AHEAD_SECONDS, PER_RELAY_PER_SECOND, RelayPool, type SocketLike } from "./pool.ts";
import { shown } from "./messages.ts";

const PLACE = "u0qj";
const NOW = 1_793_000_000; // seconds
const seed = sha256(new TextEncoder().encode("pool peer"));
const event = (content: string, at = NOW, geohash = PLACE): NostrEvent => signChat(seed, { geohash, kind: GEOHASH_MESSAGE, content }, { nowSeconds: at, mine: { targetBits: 0 } });

function rig() {
  let clock = NOW * 1000;
  const got: NostrEvent[] = [];
  const sockets: SocketLike[] = [];
  const make = (): SocketLike => {
    const s: SocketLike = { readyState: 1, send: () => {}, close: () => {}, onopen: null, onclose: null, onerror: null, onmessage: null };
    sockets.push(s);
    return s;
  };
  const pool = new RelayPool(["wss://relay.example"], (e) => got.push(e), () => {}, make, () => clock);
  pool.join(PLACE);
  sockets[0]!.onopen?.({});
  const hand = (e: unknown) => sockets[0]!.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", e]) });
  return { got, hand, tick: (s: number) => (clock += s * 1000), close: () => pool.close() };
}

test("an event dated past the clock is dropped: one after the year 275760 blanked the app, next year's hid the place", () => {
  const { got, hand, close } = rig();
  hand(event("control: now"));
  hand(event("control: 14 minutes ahead", NOW + MAX_AHEAD_SECONDS - 60));
  assert.equal(got.length, 2, "the controls pass");
  hand(event("next year", NOW + 365 * 86_400));
  hand(event("year 285000", 9_000_000_000_000));
  hand(event("before 1970", -5));
  hand(event("another place", NOW, "u0qm"));
  assert.deepEqual(got.map((e) => e.content), ["control: now", "control: 14 minutes ahead"]);
  close();
});

test("a message with an impossible time never throws while the list draws", () => {
  const far = event("year 285000", 9_000_000_000_000);
  assert.throws(() => new Date(far.created_at * 1000).toISOString(), RangeError, "the control: the date itself throws");
  assert.equal(shown(far, new Set()).atIso, "1970-01-01T00:00:00.000Z");
});

test("one relay is heard up to a rate a second; the next second it is heard again", () => {
  const { got, hand, tick, close } = rig();
  const many = Array.from({ length: PER_RELAY_PER_SECOND + 20 }, (_, i) => event(`m${i}`));
  for (const e of many) hand(e);
  assert.equal(got.length, PER_RELAY_PER_SECOND);
  tick(1);
  for (const e of many.slice(PER_RELAY_PER_SECOND)) hand(e);
  assert.equal(got.length, PER_RELAY_PER_SECOND + 20, "the rest, a second later");
  close();
});

test("the private-message inbox (slice 2): BitChat's filter (kind 1059 to one key, a day back, 100), and only wraps to that key", () => {
  const sentFrames: string[] = [];
  const got: NostrEvent[] = [];
  let socket: SocketLike | null = null;
  const pool = new RelayPool(["wss://relay.example"], (e) => got.push(e), () => {}, () => (socket = { readyState: 1, send: (d) => sentFrames.push(d), close: () => {}, onopen: null, onclose: null, onerror: null, onmessage: null }), () => NOW * 1000);
  const me = sealEnvelope(sha256(new TextEncoder().encode("me")), "a".repeat(64), "x"); // any signed wrap shape
  const myKey = "b".repeat(64);
  pool.inbox(myKey);
  socket!.onopen?.({});
  assert.deepEqual(JSON.parse(sentFrames[0]!), ["REQ", "zf1", { kinds: [1059], "#p": [myKey], since: NOW - 86_400 - 900, limit: 100 }]);
  const wrapTo = (p: string, at = NOW) => signEvent(seed, { created_at: at, kind: 1059, tags: [["p", p]], content: "v2:x" });
  const hand = (e: unknown) => socket!.onmessage?.({ data: JSON.stringify(["EVENT", "zf1", e]) });
  hand(wrapTo(myKey));
  hand(wrapTo(myKey, NOW + 1700));
  assert.equal(got.length, 2, "the controls: to me, now and with the wrap's ±15 minute jitter on top of the relays' 15");
  hand(wrapTo("c".repeat(64)));
  hand(wrapTo(myKey, NOW + 3600));
  hand({ ...wrapTo(myKey), content: "changed" });
  hand(event("a place's message"));
  hand(me);
  assert.equal(got.length, 2, "another key, an hour ahead, a broken signature, another kind: nothing");
  pool.close();
});
