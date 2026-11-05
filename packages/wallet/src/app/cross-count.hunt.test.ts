// Core hunt 5 Nov (QA): D140's once-only count after a reload. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Balance } from "../types.ts";
import { doubleCounted, newCrossState } from "./cross-count.ts";

const T0 = Date.parse("2026-11-05T21:00:00Z");
const usdc = (amount: string): Balance => ({ tokenId: "nep141:usdc.near", symbol: "USDC", name: "USDC", icon: "usdc", chain: "near", amount, usd: amount, bridged: false, held: "ledger", listed: true });
const out = (usd: string, atMs: number): SpendingActivity => ({ id: "add1", kind: "top-up", usd, status: "on-its-way", shown: true, atIso: new Date(atMs).toISOString(), words: `Moving $${usd} to your SOL wallet`, goesTo: ["sol"] });

test("control: a Home open through the move keys it to the Safe before the drop, so once the Safe shows the $30 gone nothing is taken off the wallets", () => {
  const s = newCrossState();
  assert.equal(doubleCounted(s, [usdc("40")], [], T0 - 5_000), 0);
  assert.equal(doubleCounted(s, [usdc("40")], [out("30.00", T0)], T0 + 1_000), 30, "the Safe still shows $40: the $30 on its way counts once");
  assert.equal(doubleCounted(s, [usdc("10")], [out("30.00", T0)], T0 + 3_000), 0, "the Safe shows it gone: nothing twice");
});

test("BUG cross-count.ts:79-82: the app reopened 10 s into a Move out (the Safe already shows the $30 gone) keys the move to the Safe as it is now, so Home takes the $30 off the wallets again: the total is short by the amount in flight", () => {
  const s = newCrossState();
  // first read after the reload: the Safe shows $10 (the $30 left it), spending.status counts the $30 on its way
  const twice = doubleCounted(s, [usdc("10")], [out("30.00", T0)], T0 + 10_000);
  assert.equal(twice, 0, `nothing is counted twice (the Safe $10 + the wallets' $30 on its way = the $40 the person has); got ${twice} taken off`);
});
