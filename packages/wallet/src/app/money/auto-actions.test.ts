// The product rule 1 within the audit's limits (6 Nov): each automatic action allowed only inside its limits; each one that
// needs the person refused without a tap; nothing but a read when the money is unknown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mayRun, type AutoAction } from "./auto-actions.ts";

const refund = { kind: "refund-home", hotKey: true, refunded: true, exact: true, onceByKey: true, saidOnRow: true } as const;
const retry = { kind: "own-retry", hotKey: true, ownWallet: true, provenNotGone: true, samePlace: true, usd: 5, approvedUsd: 5, backoffDone: true } as const;
const known = { tapped: false, moneyKnown: true };

test("automatic, inside its limits: re-read, same bytes, same key, an exact refund home once, an own-wallet retry", () => {
  for (const a of [{ kind: "re-read" }, { kind: "re-send", sameBytes: true }, { kind: "re-ask", sameKey: true }, refund, retry] as AutoAction[]) assert.equal(mayRun(a, known).ok, true, a.kind);
});

test("automatic, one limit broken each: refused", () => {
  const broken: AutoAction[] = [
    { kind: "re-send", sameBytes: false }, { kind: "re-ask", sameKey: false },
    ...(["hotKey", "refunded", "exact", "onceByKey", "saidOnRow"] as const).map((k) => ({ ...refund, [k]: false })),
    ...(["hotKey", "ownWallet", "provenNotGone", "samePlace", "backoffDone"] as const).map((k) => ({ ...retry, [k]: false })),
    { ...retry, usd: 5.01 }, { ...retry, usd: 0 },
  ];
  for (const a of broken) assert.equal(mayRun(a, known).ok, false, JSON.stringify(a));
});

test("needs the person: refused without a tap, allowed on it", () => {
  for (const a of [{ kind: "safe-sign" }, { kind: "payee-retry" }, { kind: "safe-fill" }, { kind: "changed", what: "amount" }, { kind: "changed", what: "recipient" }] as AutoAction[]) {
    assert.equal(mayRun(a, known).ok, false, a.kind);
    assert.equal(mayRun(a, { tapped: true, moneyKnown: true }).ok, true, a.kind);
  }
});

test("money unknown: only a read runs by itself", () => {
  const unknown = { tapped: false, moneyKnown: false };
  assert.equal(mayRun({ kind: "re-read" }, unknown).ok, true);
  for (const a of [{ kind: "re-send", sameBytes: true }, { kind: "re-ask", sameKey: true }, refund, retry] as AutoAction[]) assert.equal(mayRun(a, unknown).ok, false, a.kind);
});
