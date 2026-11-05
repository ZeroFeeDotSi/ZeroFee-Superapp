// A paid request never offers Pay again (grade 02h, H7): this device's record, the account's Activity, and one payment
// per request at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Movement } from "@zerofee/wallet/types.ts";
import { PayGate, markPaid, paidInActivity, paidState, paidWords, readPaid, shortTx } from "./paid.ts";

const req = { amount: "0.01", coin: "NEAR", chain: "near", address: "zf-sample-dana.testnet" };
const asked = "2026-11-01T23:30:00.000Z";
const LINK = "https://testnet.nearblocks.io/txns/prASoQk3VYbb8yB7fJ2nZz6m1v4hTbrau";
const move = (over: Partial<Movement> = {}): Movement => ({ id: "m1", kind: "transfer", status: "done", from: "near", to: "zf-sample-dana.testnet", amount: "0.01", startedAtIso: "2026-11-01T23:31:00.000Z", updatedAtIso: "2026-11-01T23:31:05.000Z", explorerUrls: [LINK], ...over });

test("paid from this device: the chip says Paid with the payment's id, and the book survives a reload", () => {
  const book = markPaid({}, "ev1", { link: LINK, atIso: "2026-11-01T23:31:00.000Z" });
  const mark = paidState("ev1", req, asked, book, []);
  assert.ok(mark);
  assert.equal(paidWords(mark), "Paid · prASo…brau");
  assert.deepEqual(readPaid(JSON.stringify(book)), book, "kept as written");
  assert.equal(paidState("ev2", req, asked, book, []), null, "another request is still unpaid");
});

test("paid on chain, read from the account's own Activity: the same address, the same amount, after it was asked", () => {
  assert.equal(paidWords(paidInActivity(req, asked, [move()])!), "Paid · prASo…brau");
  assert.equal(paidInActivity({ ...req, address: "ZF-SAMPLE-DANA.TESTNET" }, asked, [move()])?.from, "activity", "addresses compare without case");
  assert.equal(paidInActivity(req, asked, [move({ status: "waiting" })])?.from, "waiting", "a held payment still counts: paying again would pay twice");
  assert.equal(paidWords(paidInActivity(req, asked, [move({ status: "waiting" })])!), "Payment waiting");
  // Not this request:
  assert.equal(paidInActivity(req, asked, [move({ amount: "0.02" })]), null, "another amount");
  assert.equal(paidInActivity(req, asked, [move({ to: "guest-book.testnet" })]), null, "another receiver");
  assert.equal(paidInActivity(req, asked, [move({ startedAtIso: "2026-11-01T22:00:00.000Z" })]), null, "before it was asked");
  assert.equal(paidInActivity(req, asked, [move({ status: "refunded" })]), null, "came back");
  assert.equal(paidInActivity(req, asked, [move({ status: "problem" })]), null, "never went");
  assert.equal(paidInActivity(req, asked, [move({ kind: "deposit" })]), null, "money in is not a payment of it");
});

test("a damaged book is an empty one, never a crash or a false Paid", () => {
  for (const raw of [null, "", "{", "[]", "1", JSON.stringify({ a: null, b: { link: 3, atIso: "x" }, c: { atIso: 5 } })]) assert.deepEqual(readPaid(raw), {}, String(raw));
});

test("the book keeps the newest few hundred", () => {
  let book = {};
  for (let i = 0; i < 320; i++) book = markPaid(book, `e${i}`, { atIso: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString() });
  assert.equal(Object.keys(book).length, 300);
  assert.ok("e319" in book && !("e0" in book));
});

test("a second tap never opens a second payment", () => {
  const gate = new PayGate();
  assert.equal(gate.open("ev1", null), true, "the first tap opens the payment");
  assert.equal(gate.open("ev1", null), false, "a second tap while it opens asks nothing");
  assert.equal(gate.open("ev2", null), false, "nor does another chip");
  gate.done("ev2");
  assert.equal(gate.busy, "ev1", "only the payment that opened frees it");
  gate.done("ev1");
  const book = markPaid({}, "ev1", { link: LINK, atIso: asked });
  assert.equal(gate.open("ev1", paidState("ev1", req, asked, book, [])), false, "paid on this device: no payment at all");
  assert.equal(gate.open("ev3", paidState("ev3", req, asked, {}, [move()])), false, "paid per the account's Activity: no payment either");
  assert.equal(gate.open("ev4", paidState("ev4", { ...req, amount: "5" }, asked, {}, [move()])), true, "an unpaid request still pays");
});

test("shortTx: the end of the link, shortened; nothing for no link", () => {
  assert.equal(shortTx(undefined), "");
  assert.equal(shortTx("not a url"), "");
  assert.equal(shortTx("https://solscan.io/tx/abc"), "abc");
  assert.equal(paidWords({ atIso: asked, from: "device" }), "Paid");
});
