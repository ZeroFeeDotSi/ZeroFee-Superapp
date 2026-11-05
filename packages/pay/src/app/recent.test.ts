import { test } from "node:test";
import assert from "node:assert/strict";
import type { Movement } from "@zerofee/wallet/types.ts";
import type { Contact } from "../contacts.ts";
import { personOf, recentPeople, recipientOf } from "./recent.ts";

const at = "2026-10-26T00:00:00.000Z";
const mv = (id: string, kind: Movement["kind"], to: string, label?: string): Movement => ({ id, kind, status: "done", to, amount: "1", startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...(label ? { label } : {}) });
const BASE = "0x5a3e000000000000000000000000000000005a3e";

test("a send names its person: a NEAR account, or an address on its chain; a payment or a deposit never does", () => {
  assert.deepEqual(recipientOf(mv("1", "transfer", "ana.near")), { kind: "ledger", accountId: "ana.near" });
  assert.deepEqual(recipientOf(mv("2", "withdraw", `${BASE} on Base`)), { kind: "address", chain: "base", candidates: ["base"], address: BASE });
  assert.equal(recipientOf(mv("3", "pay", "kiosk.near")), null, "a code's deposit address is never paid twice");
  // Grade 02f: Wallet's own Send is recorded as a "pay" through its quote: its receiver is a person to offer again.
  // A NEAR send on chain (Wallet's own, or the chain's record of one) is to a NEAR wallet: native NEAR can pay it, which a
  // ledger recipient can't (the live walk: "You don't have enough to pay 7.1865 NEAR" from the chip).
  assert.deepEqual(recipientOf({ ...mv("3w", "pay", "guest-book.testnet"), caller: "wallet" }), { kind: "near-wallet", accountId: "guest-book.testnet" });
  assert.deepEqual(recipientOf({ ...mv("3c", "transfer", "guest-book.testnet"), from: "near" }), { kind: "near-wallet", accountId: "guest-book.testnet" });
  assert.equal(recipientOf(mv("4", "deposit", "nep141:usdc")), null);
  assert.equal(recipientOf(mv("5", "withdraw", `${BASE} on Nowhere`)), null, "an unknown chain is nobody to pay again");
  assert.equal(recipientOf(mv("6", "withdraw", "bc1notevm on Base")), null, "the address must fit the chain");
});

test("a saved person is named by the contact; others by the send's own label, without its note, else the account", () => {
  const ana: Contact = { id: "c1", name: "Ana", to: { kind: "ledger", accountId: "ana.near" }, addedAtIso: at };
  assert.deepEqual(personOf(mv("1", "transfer", "ana.near", "ana.near"), [ana]), { key: "c1", name: "Ana", recipient: ana.to, contactId: "c1" });
  assert.equal(personOf(mv("2", "transfer", "sam.near", "Sam: dinner"), [])?.name, "Sam");
  assert.equal(personOf(mv("3", "transfer", "sam.near"), [])?.name, "sam.near");
});

test("recent people: newest first, once each, saved people left to the contacts row", () => {
  const ana: Contact = { id: "c1", name: "Ana", to: { kind: "ledger", accountId: "ana.near" }, addedAtIso: at };
  const rows = [mv("4", "transfer", "sam.near"), mv("3", "transfer", "ana.near"), mv("2", "transfer", "sam.near"), mv("1", "withdraw", `${BASE} on Base`), mv("0", "withdraw", `${BASE} on Base`)];
  assert.deepEqual(recentPeople(rows, [ana]).map((p) => p.name), ["sam.near", "Someone on Base"]);
});
