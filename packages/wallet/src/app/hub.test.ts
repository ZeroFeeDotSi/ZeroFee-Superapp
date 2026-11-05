// The hub's rules (hub.ts): Spending's card line, where a Top up starts, one Activity row per move, a wallet's marks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAUSED_NOTE, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import type { Movement } from "../types.ts";
import { activityRows } from "./activity-rows.ts";
import { amountIn, capNeeds, marksOf, showKeyConfirmed, spendingLine, statusWords, topUpStart, typedUsd, validUsd, wholeDollars } from "./hub.ts";

const status = (o: Partial<SpendingStatus> = {}): SpendingStatus => ({ loaded: true, totalUsd: "172.54", cashUsd: "172.54", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "327.46", ready: true, networks: [], onItsWay: [], firstTopUp: false, ...o });
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "x", kind: "top-up", usd: "10.00", status: "done", shown: true, atIso: "2026-11-01T10:00:00.000Z", words: "w", ...o });

test("Spending's card: 'of $500', or why there's no number, never $0.00 (H40)", () => {
  assert.equal(spendingLine(status()), "of $500");
  assert.equal(spendingLine(status({ capUsd: "2000.00" })), "of $2,000");
  assert.equal(spendingLine(status({ loaded: false })), "Getting your wallets ready");
  assert.equal(spendingLine(status({ unread: true })), "Can't see it right now");
  assert.equal(spendingLine(null), "Getting your wallets ready");
  assert.equal(wholeDollars("12.50"), "$12.50");
});

test("a Top up starts at what fits the cap and what the Safe holds, to the cent (no float drift)", () => {
  assert.equal(topUpStart("327.46", "5254.15"), "327.46");
  assert.equal(topUpStart("500.00", "120.5"), "120.50");
  assert.equal(topUpStart("500.00", "9999"), "500");
  assert.equal(topUpStart("0.00", "100"), "", "Trading full: nothing to start at");
  assert.equal(amountIn("Top up $180.00"), "180");
  assert.equal(amountIn("Top up $1,234.50"), "1234.50");
  assert.equal(amountIn("Change the cap"), null);
  for (const ok of ["5", "5.5", "5.55"]) assert.ok(validUsd(ok), ok);
  for (const bad of ["", "0", "5.555", "abc", "-5"]) assert.ok(!validUsd(bad), bad);
});

test("Activity lists what the person did, what waits and what failed: one row per move, background moves quiet", () => {
  const rows = [
    row({ id: "t", kind: "top-up" }),
    row({ id: "p", kind: "put-away", usd: "486.60" }),
    row({ id: "e", kind: "after-export" }),
    row({ id: "r", kind: "refill", shown: false }),
    row({ id: "g", kind: "gas", shown: false }),
    row({ id: "f", kind: "refill", status: "failed", shown: true }),
  ];
  const mv = (o: Partial<Movement>): Movement => ({ id: "m", kind: "trading", status: "moving", from: "nep141:usdc", to: "trading", amount: "10", startedAtIso: "2026-11-01T10:00:20.000Z", updatedAtIso: "", explorerUrls: [], ...o });
  const topUpInLedger = mv({ id: "t" }); // still "moving": the ledger learns it on its own 20-second check
  const putAwayInLedger = mv({ id: "p", from: "trading", to: "x", amount: "486.60" });
  // the same moment and amount but another move: matched by id only, so it stays
  const twin = mv({ id: "lz", from: "trading", to: "x", amount: "486.60" });
  const sent = mv({ id: "ls", kind: "transfer", to: "kiosk.near" });
  const oldTopUp = mv({ id: "lo", startedAtIso: "2026-10-30T10:00:00.000Z" });
  const out = activityRows([topUpInLedger, putAwayInLedger, twin, sent, oldTopUp], rows);
  assert.deepEqual(out.spending.map((r) => r.id), ["t", "p", "e", "f"], "Trading's rows, refills and gas stay in Details");
  assert.deepEqual(out.ledger.map((m) => m.id), ["lz", "ls", "lo"], "the same Top up and Put away are shown once, as Trading's (Done within a second); others stay");
  const paused = row({ id: "w", status: "waiting", note: PAUSED_NOTE });
  assert.equal(statusWords(activityRows([], [paused]).spending[0]!), "Waiting · Finishes next time you open ZeroFee");
  assert.equal(statusWords({ status: "refused" }), "Refused · nothing moved");
  assert.equal(statusWords({ status: "failed", note: "Your money is in your NEAR wallet" }), "Didn't go · Your money is in your NEAR wallet");
});

test("Details' marks: Key exported first, then old words; one wallet per chain has no In use or Retired (D55, D56)", () => {
  const w = { role: "chain" as const, keyExported: false };
  assert.deepEqual(marksOf(w), []);
  assert.deepEqual(marksOf({ ...w, keyExported: true }), ["Key exported"], "D56: marked, and still the network's wallet");
  assert.deepEqual(marksOf({ ...w, role: "older" as const, keyExported: true, oldWords: true }), ["Key exported", "Opens with your old words"]);
  assert.deepEqual(marksOf({ ...w, role: "hub" as const }), []);
  assert.ok(showKeyConfirmed(" Show  my KEY "));
  assert.ok(!showKeyConfirmed("show key"));
});

test("02e, E7: amounts as people type them; the cap's button says what it needs, never a wrong number", () => {
  const cases: [string, string | null][] = [["$1,000.50", "1000.50"], ["1000,50", "1000.50"], [".5", "0.5"], ["1,000", "1000"], ["12,345,678", "12345678"], [" 25 ", "25"], ["5.", "5"], ["1,00", "1.00"], ["1,0000", null], ["abc", null], ["", null], [".", null], ["1.2.3", null]];
  for (const [raw, want] of cases) assert.equal(typedUsd(raw), want, raw);
  assert.ok(validUsd("$1,000.50") && validUsd(".5") && !validUsd("5.555"));
  assert.equal(capNeeds("", 10, 5000), "From $10 to $5,000");
  assert.equal(capNeeds(".5", 10, 5000), "At least $10");
  assert.equal(capNeeds("9000", 10, 5000), "At most $5,000");
  assert.equal(capNeeds("$1,000.50", 10, 5000), "Whole dollars only");
  assert.equal(capNeeds("1,000", 10, 5000), null);
  assert.equal(capNeeds("x", 10, 5000), "Type an amount in dollars");
});
