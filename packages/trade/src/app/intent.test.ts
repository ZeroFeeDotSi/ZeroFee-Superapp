// The Buy / Sell sheet signs only a quote prepared for the amount on screen (Security review, item 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buyPresets, canTap, intentOf, queuedGoes } from "./intent.ts";

test("a quote prepared for $50 can't be tapped once the amount says $10; the $10 quote can", () => {
  const p = {};
  const for50 = { p, for: intentOf("buy", "50"), checked: true };
  assert.equal(canTap(for50, intentOf("buy", "50"), false), true);
  assert.equal(canTap(for50, intentOf("buy", "10"), false), false, "the label says $10: the $50 quote never signs");
  assert.equal(canTap({ p, for: intentOf("buy", "10"), checked: true }, intentOf("buy", "10"), false), true);
});

test("Sell All's quote can't be tapped as Sell 25%, nor a buy's as a sell; an unproven or sending one can't either", () => {
  const p = {};
  assert.equal(canTap({ p, for: intentOf("sell", "100"), checked: true }, intentOf("sell", "25"), false), false);
  assert.equal(canTap({ p, for: intentOf("buy", "25"), checked: true }, intentOf("sell", "25"), false), false);
  assert.equal(canTap({ p, for: intentOf("buy", "25"), checked: false }, intentOf("buy", "25"), false), false);
  assert.equal(canTap({ p, for: intentOf("buy", "25"), checked: true }, intentOf("buy", "25"), true), false);
  assert.equal(canTap({}, intentOf("buy", "25"), false), false);
});

test("a press before the quote is ready goes when that same amount's checked quote lands, never under another amount", () => {
  const p = {};
  const q50 = { p, for: intentOf("buy", "50"), checked: true };
  assert.equal(queuedGoes(intentOf("buy", "50"), q50, intentOf("buy", "50"), false), true);
  assert.equal(queuedGoes(intentOf("buy", "50"), { p, for: intentOf("buy", "50"), checked: false }, intentOf("buy", "50"), false), false, "not before it's checked");
  assert.equal(queuedGoes(intentOf("buy", "50"), { p, for: intentOf("buy", "10"), checked: true }, intentOf("buy", "10"), false), false, "pressed at $50, now $10: never");
  assert.equal(queuedGoes(null, q50, intentOf("buy", "50"), false), false);
  assert.equal(queuedGoes(intentOf("buy", "50"), q50, intentOf("buy", "50"), true), false, "already sending");
});

test("a NEAR coin's Buy presets have no $1: its smallest is $2; other chains keep their $1", () => {
  assert.deepEqual(buyPresets("near"), ["2", "25", "50", "100"]);
  assert.ok(!buyPresets("near").includes("1"));
  assert.equal(Math.min(...buyPresets("near").map(Number)), 2);
  assert.deepEqual(buyPresets("sol"), ["1", "25", "50", "100"]);
});
