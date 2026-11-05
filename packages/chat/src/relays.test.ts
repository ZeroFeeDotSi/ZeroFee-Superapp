// The pinned relays: from BitChat's directory, picked the way BitChat picks a place's relays, and the test address
// switch only for this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BITCHAT_DIRECTORY } from "./directory.ts";
import { encode, center, readPlace } from "./geohash.ts";
import { ALLOWED_RELAYS, CHECK_PLACE, DM_RELAYS, askedPlace, bitchatRelays, localRelay, relaysFor, sharedWithBitChat } from "./relays.ts";

test("a place's relays are BitChat's own pick over the allow-list; private messages on BitChat's three that serve them", () => {
  for (const g of ["u0", CHECK_PLACE, "dr5r", "9q8y", "xn76", "sp"]) {
    const ours = relaysFor(g);
    assert.equal(ours.length, 5, g);
    assert.ok(ours.every((r) => ALLOWED_RELAYS.includes(r)), `${g}: only allow-listed relays`);
  }
  assert.deepEqual([...DM_RELAYS], ["wss://nos.lol", "wss://relay.primal.net", "wss://offchain.pub"]);
  assert.ok(DM_RELAYS.every((r) => ALLOWED_RELAYS.includes(r)));
  const hosts = new Set(BITCHAT_DIRECTORY.map(([h]) => h.replace(/:443$/, "")));
  for (const r of ALLOWED_RELAYS) assert.ok(hosts.has(r.slice("wss://".length)), `${r} is in BitChat's directory`);
});

test("a place's relays as BitChat picks them (closestRelays, 5, ties by host); the test check place: ours hold all BitChat's that work", () => {
  // From the directory at the pinned commit: Zurich's cell u0qj. relay.pyramid.li and the two 21crypto.ch relays
  // didn't pass the sweep's bar (tools/chat/pick-relays.ts), so they aren't in the allow-list.
  assert.deepEqual(bitchatRelays(CHECK_PLACE), ["wss://nostr.hifish.org", "wss://nostr.hifish.org:443", "wss://relay.pyramid.li", "wss://nostr-2.21crypto.ch", "wss://nostr.21crypto.ch"]);
  assert.deepEqual(sharedWithBitChat(CHECK_PLACE), ["wss://nostr.hifish.org"]);
  assert.ok(sharedWithBitChat("u0").length >= 2, "Central Europe, the busiest region on 2 Nov: sathoarder and hifish");
});

test("geohash: BitChat's precision mapping (LocationChannelsTests, the Statue of Liberty) and the reading of a typed place", () => {
  const [lat, lon] = [40.6892, -74.0445];
  const block = encode(lat, lon, 7);
  assert.equal(block.length, 7);
  for (const p of [6, 5, 4, 2]) assert.ok(block.startsWith(encode(lat, lon, p)));
  const c = center(block);
  assert.ok(Math.abs(c.lat - lat) < 0.01 && Math.abs(c.lon - lon) < 0.01);
  assert.equal(readPlace(" #U0QJ "), "u0qj");
  assert.equal(readPlace("u0qa"), null, "no a, i, l or o in a geohash");
  assert.equal(readPlace("u"), null);
});

test("the check's place switch: a geohash only, never in the public build", () => {
  assert.equal(askedPlace("?demo&chatplace=u0qj", false), "u0qj");
  assert.equal(askedPlace("?chatplace=u0qj", true), null);
  for (const bad of ["U0QJ", "u0qa", "u", "u0qj&x", "<script>"]) assert.equal(askedPlace(`?chatplace=${encodeURIComponent(bad)}`, false), null, bad);
});

test("the local relay switch: this computer only, never in the public build", () => {
  assert.equal(localRelay("?chatrelay=ws://127.0.0.1:7777", false), "ws://127.0.0.1:7777");
  assert.equal(localRelay("?demo&chatrelay=ws://localhost:7777", false), "ws://localhost:7777");
  assert.equal(localRelay("?chatrelay=ws://127.0.0.1:7777", true), null);
  for (const bad of ["wss://evil.example", "ws://10.0.0.2:7777", "ws://127.0.0.1.evil.example:7777", "ws://127.0.0.1:7777/x", "ws://127.0.0.1"]) assert.equal(localRelay(`?chatrelay=${bad}`, false), null, bad);
});
