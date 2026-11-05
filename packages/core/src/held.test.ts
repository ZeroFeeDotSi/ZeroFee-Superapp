import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TX_GAS, YES_GAS, ownCallGas, yesGasFor } from "./held.ts";

const T = 1_000_000_000_000;
/** A row is safe when its gas covers its finish cost (the contract's own work and its reserves) and 14 Tgas more (the audit's bar,
 *  release 10 round 4c: a key add's row is capped at 75 by four refills in one transaction). */
const covers = (row: { gas: number; finishTgas: number }) => row.gas >= (row.finishTgas + 14) * T;

test("the gas a second device's yes needs: its kind's row, the steps' own gas, and a link for each group of a chain", () => {
  assert.equal(yesGasFor({ SetProtection: { bands: [] } }), 25 * T);
  assert.equal(yesGasFor({ Spend: { receiver_id: "b", steps: [{ Transfer: { deposit: "1" } }] } }), 25 * T);
  assert.equal(yesGasFor({ Spend: { receiver_id: "b", steps: [{ FunctionCall: { method_name: "m", args: "", deposit: "0", gas: String(30 * T) } }] } }), 55 * T);
  const groups = Array.from({ length: 4 }, () => ({ receiver_id: "b", steps: Array.from({ length: 10 }, () => ({ Transfer: { deposit: "1" } })) }));
  assert.equal(yesGasFor({ SpendMany: { groups } }), 105 * T);
  assert.equal(yesGasFor("CancelRecovery"), 25 * T, "a unit kind arrives as a string");
  assert.equal(yesGasFor({ LegacyOff: null }), 25 * T, "a kind not in the table: state only");
});

test("release 10 round 4c: a yes that adds a key (new backup words, a second device, Agent) carries 75 Tgas, an upgrade 80", () => {
  assert.equal(yesGasFor({ SetRecoveryKey: { public_key: "x" } }), 75 * T);
  assert.equal(yesGasFor({ AddSecondDevice: { public_key: "x" } }), 75 * T);
  assert.equal(yesGasFor({ AgentSet: { public_key: "x", budget: {}, orders: [] } }), 75 * T);
  assert.equal(yesGasFor({ Upgrade: { code_hash: "h" } }), 80 * T);
  assert.equal(ownCallGas("SetRecoveryKey"), 75n * BigInt(T), "the phone's own first set_recovery_key, which finishes at once");
  assert.equal(ownCallGas("AddSecondDevice"), 75n * BigInt(T));
  assert.equal(ownCallGas("AgentSet"), 75n * BigInt(T));
});

test("every kind's gas is its finish cost plus at least 14 Tgas; control: the old figures fail the same check", () => {
  for (const [kind, row] of Object.entries(YES_GAS)) assert.ok(covers(row), `${kind}: ${row.gas / T} Tgas for a ${row.finishTgas} Tgas finish`);
  // Control: the rows before the fix (SetRecoveryKey 15 against its measured 26.3, AddSecondDevice 25 against 26.2,
  // AgentSet 15, the base 15 against 3.5, Upgrade 70 against its bound of 60) are each caught.
  // Release 10 round 4c: main's 50 for a key add, against a 40 Tgas reserve, is caught too.
  const old = { SetRecoveryKey: 15, AddSecondDevice: 25, AgentSet: 15, SetProtection: 15, Upgrade: 70 } as const;
  for (const kind of ["SetRecoveryKey", "AddSecondDevice", "AgentSet"]) assert.equal(covers({ gas: 50 * T, finishTgas: YES_GAS[kind]!.finishTgas }), false, `${kind} at 50 Tgas`);
  for (const [kind, tgas] of Object.entries(old)) assert.equal(covers({ gas: tgas * T, finishTgas: YES_GAS[kind]!.finishTgas }), false, `${kind} at ${tgas} Tgas`);
  // Control: the phone's old 30 Tgas direct call (a ~3 Tgas margin) fails too.
  assert.equal(covers({ gas: 30 * T, finishTgas: YES_GAS.SetRecoveryKey!.finishTgas }), false);
  assert.ok(covers({ gas: Number(ownCallGas("SetRecoveryKey")), finishTgas: YES_GAS.SetRecoveryKey!.finishTgas }));
});

test("a transaction stays within 300 Tgas; control: what would pass it is capped", () => {
  for (const [kind, row] of Object.entries(YES_GAS)) assert.ok(row.gas <= MAX_TX_GAS, kind);
  // The contract lets a request's steps and links carry 250 Tgas in all (MAX_CHAIN_GAS): with any row on top, still within.
  const most = Math.max(...Object.values(YES_GAS).map((r) => r.gas));
  assert.ok(YES_GAS.SpendMany!.gas + 250 * T <= MAX_TX_GAS && YES_GAS.Spend!.gas + 250 * T <= MAX_TX_GAS, "a payment's row and its most steps");
  assert.ok(most <= MAX_TX_GAS);
  // Control: 4 groups x 10 calls of 30 Tgas would ask 1,305 Tgas; the yes carries 300.
  const calls = Array.from({ length: 4 }, () => ({ receiver_id: "b", steps: Array.from({ length: 10 }, () => ({ FunctionCall: { gas: String(30 * T) } })) }));
  assert.equal(yesGasFor({ SpendMany: { groups: calls } }), MAX_TX_GAS);
  // The phone's own transactions: set-up (new at 30 Tgas, then the first backup words) and refilling four second devices.
  assert.ok(30n * BigInt(T) + ownCallGas("SetRecoveryKey") <= BigInt(MAX_TX_GAS), "set-up's calls");
  assert.ok(4n * ownCallGas("AddSecondDevice") <= BigInt(MAX_TX_GAS), "four second devices refilled in one transaction");
  // Control: at 80 Tgas a call, four would not fit.
  assert.equal(4n * 80n * BigInt(T) <= BigInt(MAX_TX_GAS), false);
});
