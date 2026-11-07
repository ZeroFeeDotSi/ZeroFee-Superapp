// QA's MUST (7 Nov, main's Sim shots): the Safe sent $30.00 and Private paid bob.near $25.00, yet Activity's
// Send row said "From Private" (format.ts keyed on m.private, and every safe-send: record is private), while its job said
// "Leaving your Safe" (live-steps sendFrom). One rule decides From for the row, its page, the statement and the job:
// where the money LEFT. Each table fails on cbaddc66d (named per test); each has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement, Token } from "../types.ts";
import { SEND_FROM, describe as describeRow, sendFrom, whereNow } from "./format.ts";
import { ledgerRow, movementFacts } from "./statement.ts";
import { sendTrack } from "./money/live-steps.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKENS = new Map<string, Token>([[USDC, { id: USDC, symbol: "USDC", decimals: 6, priceUsd: 1 } as Token]]);
const at = "2026-01-01T00:00:00.000Z";
const mv = (id: string, o: Partial<Movement> = {}): Movement => ({ id, kind: "pay", status: "done", from: USDC, to: "bob.near", amount: "25", startedAtIso: at, updatedAtIso: at, explorerUrls: ["https://nearblocks.io/txns/abc"], private: true, ...o } as Movement);
const SAFE_SEND = mv("safe-send:s1", { kept: "5" } as Partial<Movement>);
const POCKET_SEND = mv("pocket-send:p1");
const PRIVATE_PAY = mv("pay:x1");            // private-pay.ts: a payment from Private's own balance
const ROW_SEND = mv("hidden-row:r1", { from: "nep141:sol.omft.near", amount: "0.1" });
const PLAIN = mv("transfer:t1", { private: undefined, to: "kim.near" });

test("one rule: where the money left (on cbaddc66d a safe-send: read Safe on its job, Private everywhere else)", () => {
  const table: [Movement, string][] = [[SAFE_SEND, "safe"], [POCKET_SEND, "private"], [PRIVATE_PAY, "private"], [ROW_SEND, "sol"], [PLAIN, "safe"]];
  for (const [m, want] of table) assert.equal(sendFrom(m), want, m.id);
  // the job reads the same rule: its first step names the place the money left
  assert.equal(sendTrack(SAFE_SEND)!.steps[0]!.label, "Left your Safe");
  assert.equal(sendTrack(POCKET_SEND)!.steps[0]!.label, "Left Private", "control (copy review, 7 Nov: \"Private\")");
  // on cbaddc66d a payment from Private's own balance (pay:) said "Left your Safe"
  assert.equal(sendTrack(PRIVATE_PAY)!.steps[0]!.label, "Left Private");
});

test("Activity's row: a safe-send: reads From your Safe (on cbaddc66d \"From Private · to bob.near\"); a pocket-send: reads From Private", () => {
  assert.equal(describeRow(SAFE_SEND, TOKENS, []).detail, "From your Safe · to bob.near");
  assert.equal(describeRow(POCKET_SEND, TOKENS, []).detail, "From Private · to bob.near", "control: Private's own payment");
  assert.equal(describeRow(PRIVATE_PAY, TOKENS, []).detail, "From Private · to bob.near", "control: Pay from Private");
  assert.equal(describeRow(PLAIN, TOKENS, []).detail, "to kim.near", "control: a plain Send names no From");
  // no price: the coin leads, then where it left
  assert.match(describeRow({ ...SAFE_SEND, from: "nep141:unknown.near" }, TOKENS, []).detail, /^25 +from your Safe · to bob\.near$/);
  for (const m of [SAFE_SEND, POCKET_SEND]) assert.doesNotMatch(describeRow({ ...m, status: "moving" }, TOKENS, []).detail, m === SAFE_SEND ? /Private/ : /Safe/, `${m.id} moving`);
});

test("the row's page and the statement: From is where it left (on cbaddc66d a safe-send: said \"Private balance\")", () => {
  assert.equal(ledgerRow(SAFE_SEND, TOKENS, [])!.from, "Safe");
  assert.equal(ledgerRow(SAFE_SEND, TOKENS, [])!.hidden, "yes", "it still went through NEAR Confidential");
  assert.equal(ledgerRow(POCKET_SEND, TOKENS, [])!.from, "Private", "control (copy review, 7 Nov: \"Private\")");
  assert.equal(ledgerRow(ROW_SEND, TOKENS, [])!.from, "SOL wallet");
  assert.equal(ledgerRow(PLAIN, TOKENS, [])!.from, "Safe", "control: a plain Send");
  assert.deepEqual(movementFacts(SAFE_SEND, TOKENS, []).find((f) => f.label === "From"), { label: "From", value: "Safe" });
  assert.deepEqual(movementFacts(POCKET_SEND, TOKENS, []).find((f) => f.label === "From"), { label: "From", value: "Private" });
});

test("the Safe's Send's page: \"Stays in Private\" from the record's own kept figure (on cbaddc66d no such line); control: none without a kept, none once it didn't pay", () => {
  const kept = (m: Movement) => movementFacts(m, TOKENS, []).find((f) => f.label === "Stays in Private")?.value;
  assert.equal(kept(SAFE_SEND), "$5.00");
  assert.equal(kept({ ...SAFE_SEND, status: "moving" }), "$5.00");
  assert.equal(kept({ ...SAFE_SEND, kept: "4.999999" } as Movement), "$5.00", "the record's figure, to the cent");
  assert.equal(kept({ ...SAFE_SEND, kept: undefined } as Movement), undefined, "control: the record carries none, the page says none");
  assert.equal(kept({ ...SAFE_SEND, status: "problem" }), undefined, "control: it didn't pay, so it isn't a share that stays");
  assert.equal(kept({ ...POCKET_SEND, kept: "5" } as Movement), undefined, "control: Private's own payment kept nothing back from the Safe");
  assert.deepEqual(movementFacts(SAFE_SEND, TOKENS, []).map((f) => f.label), ["From", "To", "Stays in Private"]);
});

test("a refund's place is the quote's refundTo, not where it left: a safe-send's leg 1 and leg 2 both refund to the pocket (core: refundTo = the pocket, CONFIDENTIAL_INTENTS)", () => {
  // kept as it is on purpose: the page names the Safe as where it LEFT, and Private as where a refund lands
  assert.equal(whereNow({ ...SAFE_SEND, status: "refunded" }, ""), "back in Private");
  assert.equal(whereNow({ ...PLAIN, status: "refunded" }, ""), "back in your Safe", "control: a plain Send's refund");
  // a hold cancelled before leg 1 went: nothing left the Safe, and the row says so in one voice
  const held = describeRow({ ...SAFE_SEND, status: "problem", explorerUrls: [], problem: { code: "ledger.hold.cancelled", whatHappened: "You cancelled it, so nothing moved.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Done" } } } as Movement, TOKENS, []);
  assert.equal(held.detail, "From your Safe · still in your Safe");
});

test("the audit's M1: a private record whose id the table doesn't name gets no From, never a guess (on f45257e2a it read \"From Private\"); controls: each named id keeps its place", () => {
  const odd = mv("mv-9");
  assert.equal(sendFrom(odd), "");
  assert.equal(describeRow(odd, TOKENS, []).detail, "to bob.near");
  assert.equal(ledgerRow(odd, TOKENS, [])!.from, "");
  assert.equal(movementFacts(odd, TOKENS, []).find((f) => f.label === "From"), undefined, "no From line on its page");
  assert.equal(sendFrom(mv("pay:p2", { private: undefined })), "safe", "control: a plain pay: from the Safe is the Safe's");
  assert.equal(sendFrom(mv("pocket-send:p3", { private: undefined })), "private", "control: pocket-send: is Private by its id");
  assert.equal(sendFrom({ ...odd, from: "private" }), "private", "control: the record's own from");
});

test("the audit's M1: every id prefix a private payment record is written with is in the table (scans the writers; control: the scan finds safe-send: and pay:)", () => {
  const root = new URL("../../../../", import.meta.url);
  const files = ["packages/wallet/src/safe-send.ts", "packages/wallet/src/hidden-row.ts", "packages/wallet/src/private-pay.ts", "packages/shell-api/src/MockBridge.ts"];
  const found = new Map<string, string>();
  for (const file of files) {
    const lines = readFileSync(new URL(file, root), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/\bprivate: true\b/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const back = lines.slice(Math.max(0, i - 12), i + 1);
      if (!back.some((l) => /kind: "pay"|move\("pay"/.test(l))) return;   // not a payment record
      const at = [...back].reverse().find((l) => /\bid: `/.test(l));
      assert.ok(at, `${file}:${i + 1}: a private payment record with no id`);
      const lit = /\bid: `([a-z-]+):/.exec(at!)?.[1];
      // a prefix from a parameter (MockBridge's pay(..., kind: "safe-send" | "pocket-send")): each of its literals
      const viaKind = /\bid: `\$\{kind\}:/.test(at!) ? [...(lines.slice(Math.max(0, i - 12), i).reverse().find((l) => /kind: "[a-z-]+"( \| "[a-z-]+")+/.test(l)) ?? "").matchAll(/"([a-z-]+)"/g)].map((x) => x[1]!) : [];
      const prefixes = lit ? [lit] : viaKind;
      assert.ok(prefixes.length > 0, `${file}:${i + 1}: an id the scan can't read`);
      for (const p of prefixes) found.set(p, `${file}:${i + 1}`);
    });
  }
  for (const want of ["safe-send", "pocket-send", "pay", "hidden-row"]) assert.ok(found.has(want), `control: the scan finds ${want}:`);
  for (const [p, where] of found) assert.ok(p === "hidden-row" || p in SEND_FROM, `${where}: "${p}:" isn't in format.ts SEND_FROM`);
});
