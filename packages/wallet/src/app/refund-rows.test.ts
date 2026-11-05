// S5 (the copy review's Sim walk, 5 Nov): after a Swap paid from Private came back, Activity showed the payment's own row
// "Came back · 25 USDC from your private balance · back in your Safe" beside the Move's "Didn't move $26.00 … Private":
// one job, two rows, two places for the money.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../types.ts";
import { activityRows } from "./activity-rows.ts";
import { whereNow } from "./format.ts";

const mv = (o: Partial<Movement>): Movement => ({ id: "pocket-send:a", kind: "pay", status: "refunded", amount: "25", from: "usdc", to: "sol-addr", startedAtIso: "2026-11-05T00:00:00Z", updatedAtIso: "2026-11-05T00:00:01Z", explorerUrls: [], private: true, ...o } as Movement);
const move = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-k", kind: "top-up", usd: "26.00", status: "failed", shown: true, atIso: "2026-11-05T00:00:01Z", words: "Didn't move $26.00 to your SOL wallet", via: "private", ...o } as SpendingActivity);

test("a Move's payment from Private folds into the Move's row (control: a payment of no shown move keeps its own row)", () => {
  const pay = mv({}), other = mv({ id: "pocket-send:b" });
  const { ledger, spending } = activityRows([pay, other], [move({ paid: ["pocket-send:a"] })]);
  assert.deepEqual(ledger.map((m) => m.id), ["pocket-send:b"]);
  assert.equal(spending.length, 1);
  // control: the Move not shown (a background one): its payment stays
  assert.deepEqual(activityRows([pay], [move({ paid: ["pocket-send:a"], shown: false })]).ledger.map((m) => m.id), ["pocket-send:a"]);
});

test("a payment from the private balance that came back is back in Private, its refund address (controls: a Safe's own Send and a Trading move as before)", () => {
  assert.equal(whereNow(mv({}), "x"), "back in Private");
  assert.equal(whereNow(mv({ private: false }), "x"), "back in your Safe");
  assert.equal(whereNow(mv({ kind: "trading", private: false }), "x"), "back in your NEAR wallet");
});
