// J3 part 1, Chat's bugs (AUDIT-2026-11-02 D5), as plain logic: your own messages are "You" whenever they arrive (C2),
// a person with no name seen is "Someone in <place>" (C3), a private message is on screen before it is posted so a
// fast ack finds it, says so when no ack comes in 10 s, and goes again with its id kept (C4). Each with a control that
// passes, so a failure is for the reason named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, signChat, type NostrEvent } from "@zerofee/core/nostr";
import { ACK_WAIT_MS, delivery, late, lateWords, nextLate, peerName, receive, retrying, sending, type Dms } from "./dms.ts";
import { markMine, requestText, shown } from "./messages.ts";
import { RelayPool, type SocketLike } from "./pool.ts";

const PLACE = "u0qj";
const NOW = 1_800_000_000;
const AVA = sha256(new TextEncoder().encode("ava"));
const OTHER = sha256(new TextEncoder().encode("another ava"));
const post = (seed: Uint8Array, content: string, nickname = "Ava"): NostrEvent => signChat(seed, { geohash: PLACE, kind: GEOHASH_MESSAGE, content, nickname, teleport: true }, { nowSeconds: NOW, mine: { targetBits: 0 } });

test("C2: your own post that arrived before your key was known becomes 'You'; someone else with your name stays theirs", () => {
  const mine = post(AVA, "hello from Ava");
  const theirs = post(OTHER, "hello from Ava");
  const request = post(AVA, requestText({ amount: "1", coin: "NEAR", chain: "near", address: "zf-sample123456.testnet" }));
  // The place's last hour, read before the core said which key is Ava's: all three look like strangers.
  const early = [shown(mine, new Set()), shown(theirs, new Set()), shown(request, new Set())];
  assert.deepEqual(early.map((m) => m.mine), [false, false, false]);
  assert.ok(early[2]!.request, "control: a stranger's request has a Pay chip");
  const key = mine.pubkey;
  const marked = markMine(early, new Set([key]), new Set());
  assert.deepEqual(marked.map((m) => m.mine), [true, false, true], "Ava's two are hers; the other Ava (another key) is not");
  assert.equal(marked[2]!.request, undefined, "your own request never offers Pay");
  assert.equal(markMine(marked, new Set([key]), new Set()), marked, "nothing to change: the same list");
  // By the id of what you posted, before any key is known.
  const byId = markMine([shown(mine, new Set())], new Set(), new Set([mine.id]));
  assert.equal(byId[0]!.mine, true);
  assert.equal(shown(mine, new Set(), new Set([mine.id])).mine, true, "and as it arrives");
});

test("C3: a person whose name hasn't been seen is 'Someone in Zurich', never a made-up anon name; two are numbered", () => {
  const BEN = "b".repeat(64);
  const CY = "c".repeat(64);
  let dms: Dms = receive({}, BEN, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false }).dms;
  const names = new Map<string, string>();
  const known = (k: string) => names.get(k);
  assert.equal(peerName(BEN, known, dms, "Zurich"), "Someone in Zurich");
  assert.doesNotMatch(peerName(BEN, known, dms, "Zurich"), /anon|#/);
  dms = receive(dms, CY, NOW + 5, { kind: "message", messageId: "M2", text: "hey" }, { muted: false, viewing: false }).dms;
  assert.equal(peerName(BEN, known, dms, "Zurich"), "Someone in Zurich (1)");
  assert.equal(peerName(CY, known, dms, "Zurich"), "Someone in Zurich (2)");
  names.set(BEN, "Ben#c540");
  assert.equal(peerName(BEN, known, dms, "Zurich"), "Ben#c540", "once Ben posts in the place, his name");
  assert.equal(peerName(CY, known, dms, "Zurich"), "Someone in Zurich", "the one left needs no number");
});

test("C4: an ack that comes back before the relays answer finds the message (it is on screen as Sending… first)", () => {
  const BEN = "b".repeat(64);
  // The order Chat now uses: on screen, then posted; Ben's ack lands while the relays are still answering.
  let dms = sending({}, BEN, "M1", "hi Ben", NOW);
  dms = receive(dms, BEN, NOW + 1, { kind: "delivered", messageId: "M1" }, { muted: false, viewing: true }).dms;
  dms = delivery(dms, BEN, "M1", "sent");
  assert.equal(dms[BEN]!.lines[0]!.status, "delivered", "the relays' later 'took it' never moves it back");
  // Control, the old order: posted first, the ack arrives before the line exists, and is lost.
  let old: Dms = {};
  old = receive(old, BEN, NOW + 1, { kind: "delivered", messageId: "M1" }, { muted: false, viewing: true }).dms;
  old = delivery(sending(old, BEN, "M1", "hi Ben", NOW), BEN, "M1", "sent");
  assert.equal(old[BEN]!.lines[0]!.status, "sent", "the old order stays Sent for ever");
});

test("C4: no 'Delivered' in 10 s says so plainly, with Send again; a delivered one never does", () => {
  const BEN = "b".repeat(64);
  const t0 = NOW * 1000;
  let dms = delivery(sending({}, BEN, "M1", "hi Ben", NOW), BEN, "M1", "sent");
  const line = () => dms[BEN]!.lines[0]!;
  assert.equal(late(line(), t0 + ACK_WAIT_MS - 1), false);
  assert.equal(nextLate(dms[BEN]!.lines, t0 + 4000), ACK_WAIT_MS - 4000, "the screen looks again when it is due");
  assert.equal(late(line(), t0 + ACK_WAIT_MS), true);
  assert.equal(lateWords(line().status), "Not delivered yet. They may be offline.");
  // Send again: the same id, Sending… then Sent, and a fresh 10 s.
  dms = retrying(dms, BEN, "M1", t0 + 12_000);
  assert.equal(line().status, "sending");
  assert.equal(line().id, "M1");
  dms = delivery(dms, BEN, "M1", "sent");
  assert.equal(late(line(), t0 + 12_000 + ACK_WAIT_MS - 1), false);
  dms = receive(dms, BEN, NOW + 13, { kind: "delivered", messageId: "M1" }, { muted: false, viewing: true }).dms;
  assert.equal(late(line(), t0 + 60_000), false, "delivered: never late");
  assert.equal(nextLate(dms[BEN]!.lines, t0 + 60_000), null);
  // Not sent at all (no server took it): late at once, with its own words.
  const failed = delivery(sending({}, BEN, "M2", "x", NOW), BEN, "M2", "failed")[BEN]!.lines[0]!;
  assert.equal(late(failed, t0), true);
  assert.equal(lateWords(failed.status), "Not sent. Check your internet connection.");
});

test("C4: a message sent again is shown once and acked again; the same copy read again is not acked twice", () => {
  const AV = "a".repeat(64);
  const first = receive({}, AV, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false });
  assert.equal(first.ack, "M1");
  const replay = receive(first.dms, AV, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false });
  assert.equal(replay.ack, null, "control: the day's copy read again on opening is not acked again");
  const resent = receive(first.dms, AV, NOW + 12, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false });
  assert.equal(resent.ack, "M1", "sent again: acked again");
  assert.equal(resent.dms[AV]!.lines.length, 1, "and shown once");
  assert.equal(receive(resent.dms, AV, NOW + 12, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false }).ack, null, "that copy only once");
  assert.equal(receive(resent.dms, AV, NOW + 12, { kind: "message", messageId: "M1", text: "hi" }, { muted: true, viewing: false }).ack, null, "never to a muted sender");
});

test("C4: a private message written while the socket is still opening goes when it opens, never 'Not sent'", async () => {
  const sockets: (SocketLike & { sent: string[] })[] = [];
  const make = (): SocketLike => {
    const s = { readyState: 0, sent: [] as string[], send(d: string) { this.sent.push(d); }, close: () => {}, onopen: null, onclose: null, onerror: null, onmessage: null } as SocketLike & { sent: string[] };
    sockets.push(s);
    return s;
  };
  const pool = new RelayPool(["ws://127.0.0.1:7777"], () => {}, () => {}, make);
  pool.inbox("a".repeat(64));
  const e = post(AVA, "wrap stand-in");
  const result = pool.publish(e);
  const s = sockets[0]!;
  assert.equal(s.sent.length, 0, "nothing sent on a socket that isn't open");
  s.readyState = 1;
  s.onopen?.({});
  assert.ok(s.sent.some((d) => d.startsWith('["REQ"')), "the subscription goes");
  assert.ok(s.sent.some((d) => JSON.parse(d)[0] === "EVENT" && JSON.parse(d)[1].id === e.id), "and the message");
  s.onmessage?.({ data: JSON.stringify(["OK", e.id, true, ""]) });
  assert.deepEqual(await result, { ok: 1, of: 1 });
  pool.close();
  // Control: with no socket at all, it says not sent at once.
  const none = new RelayPool([], () => {}, () => {}, make);
  assert.deepEqual(await none.publish(e), { ok: 0, of: 0 });
});
