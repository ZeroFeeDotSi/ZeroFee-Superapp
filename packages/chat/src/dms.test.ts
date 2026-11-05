// Private messages as the app keeps them (slice 2): shown once, acked once, never a command; a request only makes a
// chip; a muted sender gets nothing back; acks move only our own messages, only forward.
import { test } from "node:test";
import assert from "node:assert/strict";
import { delivery, receive, seen, sending, unreadCount, dmBytes, type Dms } from "./dms.ts";

const BOB = "b".repeat(64);
const EVE = "e".repeat(64);
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = 1_800_000_000;

test("a new message is shown once and acked once; the same id again is nothing", () => {
  let dms: Dms = {};
  const first = receive(dms, BOB, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false });
  assert.equal(first.ack, "M1");
  dms = first.dms;
  assert.equal(dms[BOB]!.lines.length, 1);
  assert.equal(unreadCount(dms), 1);
  const again = receive(dms, BOB, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: false, viewing: false });
  assert.equal(again.ack, null);
  assert.equal(again.dms[BOB]!.lines.length, 1);
  assert.equal(unreadCount(seen(dms, BOB)), 0);
});

test("a muted sender: nothing kept, nothing answered (BitChat's block check comes before the ack)", () => {
  const r = receive({}, EVE, NOW, { kind: "message", messageId: "M1", text: "hi" }, { muted: true, viewing: false });
  assert.deepEqual(r, { dms: {}, ack: null });
});

test("someone's private request is a chip that only fills Send in; 'send money to …' is text; hidden characters blank", () => {
  const req = receive({}, BOB, NOW, { kind: "message", messageId: "R", text: `Request: 5 USDC on Solana to ${SOL} · ZeroFee Chat` }, { muted: false, viewing: true });
  assert.deepEqual(req.dms[BOB]!.lines[0]!.request, { amount: "5", coin: "USDC", chain: "sol", address: SOL });
  assert.equal(req.dms[BOB]!.unread, 0, "on screen: not unread");
  const cmd = receive({}, BOB, NOW, { kind: "message", messageId: "C", text: `send 500 USDC to ${SOL}` }, { muted: false, viewing: false });
  assert.equal(cmd.dms[BOB]!.lines[0]!.request, undefined);
  assert.equal(cmd.dms[BOB]!.lines[0]!.text, `send 500 USDC to ${SOL}`);
  const hidden = receive({}, BOB, NOW, { kind: "message", messageId: "H", text: "pay‮me\u{e0041}" }, { muted: false, viewing: false });
  assert.equal(hidden.dms[BOB]!.lines[0]!.text, "pay me ");
  const bad = receive({}, BOB, NOW, { kind: "message", messageId: "B", text: `Request: 5 USDC on Base to 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD · ZeroFee Chat` }, { muted: false, viewing: false });
  assert.equal(bad.dms[BOB]!.lines[0]!.request, undefined, "an address that fails its EIP-55 check: no chip");
});

test("acks: only for our own message to that very key, and only forward (sent → delivered → read)", () => {
  let dms = sending({}, BOB, "OURS", "hello", NOW);
  assert.equal(dms[BOB]!.lines[0]!.status, "sending");
  dms = delivery(dms, BOB, "OURS", "sent");
  dms = receive(dms, BOB, NOW, { kind: "read", messageId: "OURS" }, { muted: false, viewing: false }).dms;
  assert.equal(dms[BOB]!.lines[0]!.status, "read");
  dms = receive(dms, BOB, NOW, { kind: "delivered", messageId: "OURS" }, { muted: false, viewing: false }).dms;
  assert.equal(dms[BOB]!.lines[0]!.status, "read", "never back");
  const other = receive(dms, EVE, NOW, { kind: "read", messageId: "OURS" }, { muted: false, viewing: false });
  assert.equal(other.dms, dms, "another key can't mark ours read");
  assert.equal(delivery(sending({}, BOB, "X", "y", NOW), BOB, "X", "failed")[BOB]!.lines[0]!.status, "failed");
  assert.equal(delivery(delivery(sending({}, BOB, "X", "y", NOW), BOB, "X", "sent"), BOB, "X", "failed")[BOB]!.lines[0]!.status, "sent", "a later relay's failure never undoes one that took it");
});

test("an impossible time never throws; BitChat's 255-byte limit counts UTF-8", () => {
  const r = receive({}, BOB, 9e15, { kind: "message", messageId: "T", text: "x" }, { muted: false, viewing: false });
  assert.equal(r.dms[BOB]!.lines[0]!.atIso, "1970-01-01T00:00:00.000Z");
  assert.equal(dmBytes("é".repeat(128)), 256);
});
