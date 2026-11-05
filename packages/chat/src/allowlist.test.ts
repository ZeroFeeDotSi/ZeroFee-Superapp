// The relay allow-list: about 40 exact hosts from BitChat's directory, its DM relays among them, and a place's relays picked
// the way BitChat picks them, over the allow-list; it shares relays with BitChat's own 5 for the busy places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BITCHAT_DIRECTORY } from "./directory.ts";
import { bitchatRelays } from "./relays.ts";
import { ALLOWED_RELAYS, DM_RELAYS, closestIn, placeRelays, relayHost } from "./allowlist.ts";

const DIRECTORY = new Set(BITCHAT_DIRECTORY.map(([h]) => relayHost(h)));

test("about 40 relays, exact hosts, no duplicates, each from BitChat's directory or one of its DM relays", () => {
  assert.ok(ALLOWED_RELAYS.length >= 35 && ALLOWED_RELAYS.length <= 45, `${ALLOWED_RELAYS.length}`);
  assert.equal(new Set(ALLOWED_RELAYS).size, ALLOWED_RELAYS.length);
  for (const r of ALLOWED_RELAYS) {
    assert.match(r, /^wss:\/\/[a-z0-9.-]+\.[a-z]{2,}$/);
    assert.ok(DIRECTORY.has(relayHost(r)) || DM_RELAYS.includes(r), `${r} is in BitChat's directory`);
  }
});

test("BitChat's built-in DM relays are allowed, but relay.damus.io (it serves gift wraps only after AUTH)", () => {
  assert.deepEqual([...DM_RELAYS].sort(), ["wss://nos.lol", "wss://offchain.pub", "wss://relay.primal.net"]);
  for (const r of DM_RELAYS) assert.ok(ALLOWED_RELAYS.includes(r), r);
  assert.ok(!ALLOWED_RELAYS.includes("wss://relay.damus.io"));
});

test("closestIn is BitChat's closestRelays over a subset: host and host:443 as one, ties by host", () => {
  // Over the whole directory it is BitChat's own pick, normalised and without the second spelling.
  for (const g of ["u0qj", "dr5r", "9q8y", "u", "s0"]) {
    const all = [...new Set(BITCHAT_DIRECTORY.map(([h]) => `wss://${relayHost(h)}`))];
    const mine = closestIn(all, g, 8).map(relayHost);
    const theirs = [...new Set(bitchatRelays(g, 12).map(relayHost))].slice(0, 8);
    assert.deepEqual(mine, theirs, g);
  }
  // Zurich's u0qj, BitChat's 5: nostr.hifish.org twice, relay.pyramid.li, nostr-2.21crypto.ch, nostr.21crypto.ch.
  assert.deepEqual(closestIn(["wss://nostr.21crypto.ch", "wss://nostr.hifish.org", "wss://nos.lol"], "u0qj", 2), ["wss://nostr.hifish.org", "wss://nostr.21crypto.ch"]);
});

test("placeRelays, checked by hand: Central Europe (#u0, centre 47.8125, 5.625), the busiest place on 1 Nov", () => {
  // Strasbourg 178.9 km, Zurich 225.4, Karlsruhe 242.8, Graubuenden 329.0, Roubaix 365.3; Munich next at 446.0.
  assert.deepEqual(placeRelays("u0"), ["wss://nostr.sathoarder.com", "wss://nostr.hifish.org", "wss://relay.layer.systems", "wss://relay.guggero.org", "wss://nostr-relay.xbytez.io"]);
  // BitChat's 5 there: relay.artio.inf.unibe.ch and relay.pyramid.li (neither answered on 1 Nov), sathoarder, hifish twice.
  assert.deepEqual(placeRelays("u0").filter((r) => bitchatRelays("u0").map(relayHost).includes(relayHost(r))), ["wss://nostr.sathoarder.com", "wss://nostr.hifish.org"]);
});

// The 30 busiest places in the 1 Nov sweeps (by distinct senders), each with how many of BitChat's 5 for it answered
// from here then (tools/chat/pick-relays.ts): "all" = every one of those is ours.
const BUSIEST: readonly (readonly [place: string, working: number])[] = [
  ["u0", 2], ["sp", 2], ["u3", 2], ["6g", 1], ["u1", 2], ["sx", 3], ["dh11", 3], ["ud", 4], ["pene", 2], ["9q", 2],
  ["dp", 1], ["dr", 5], ["sv", 2], ["u0h1hu", 2], ["uc", 3], ["9gbud", 3], ["gc", 4], ["sr", 4], ["sw", 3], ["u2", 3],
  ["sy", 2], ["9v", 3], ["dh", 4], ["bujunbur", 2], ["dj", 2], ["ny", 2], ["st", 4], ["svbb", 3], ["u0h14", 2], ["wh220u", 3],
];

test("the busiest places: ours share a relay with BitChat's at 29 of 30, and have all of its working ones at 25", () => {
  let shared = 0;
  let all = 0;
  for (const [g, working] of BUSIEST) {
    const theirs = new Set(bitchatRelays(g).map(relayHost));
    const common = placeRelays(g).filter((r) => theirs.has(relayHost(r))).length;
    assert.ok(common <= working, `${g}: ${common} shared, but only ${working} of BitChat's answered`);
    if (common > 0) shared++;
    if (common === working) all++;
  }
  assert.ok(shared >= 28, `${shared}/30 share at least one`);
  assert.ok(all >= 23,`${all}/30 have all of BitChat's working relays`);
});

test("placeRelays: 5 from the allow-list", () => {
  for (const g of ["u0qj", "dr5r", "9q8y", "w", "qqgu"]) {
    const r = placeRelays(g);
    assert.equal(r.length, 5);
    for (const x of r) assert.ok(ALLOWED_RELAYS.includes(x), x);
  }
});
