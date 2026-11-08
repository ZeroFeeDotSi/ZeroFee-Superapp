// the audit's Move S5 + Send S2 (8 Nov): a Move to several places is titled by placesWords, as its receipt and the floor say
// them (it was "Move $30.00"); a stopped receipt leads with the stop (it was "Sending it to bob.near. NEAR said no.").
// Fails on its base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveTitle } from "../screens/move-run.ts";
import { receiptSaid, sendWords } from "./receipt-said.ts";
import type { Leg } from "../screens/move-split.ts";

const L = (from: Leg["from"], to: Leg["to"], usd: number) => ({ from, to, usd }) as Leg;

test("a Move to several places names them all, as the receipt does; one place as before", () => {
  assert.equal(moveTitle([L("safe", "sol", 20), L("safe", "hood", 10)]), "Move $30.00 to your SOL and Robinhood wallets");
  assert.equal(moveTitle([L("sol", "safe", 5), L("hood", "near", 5)]), "Move $10.00 to your Safe and your NEAR wallet");
  assert.equal(moveTitle([L("safe", "sol", 30)]), "Move $30.00 to your SOL wallet", "control: one place");
});

test("a stopped receipt leads with the stop; going, landed and unsure as before", () => {
  const w = sendWords("bob.near");
  assert.equal(receiptSaid(w, { state: "stopped", words: "NEAR said no. It's still in your Safe." }), "Not sent to bob.near. NEAR said no. It's still in your Safe.");
  assert.equal(receiptSaid(w, { state: "stopped" }), "Not sent to bob.near.", "no words of its own: still the stop, never \"Sending\"");
  assert.equal(receiptSaid(w, { state: "unsure", words: "Activity shows where your money is." }), "Sending it to bob.near. Activity shows where your money is.");
  assert.equal(receiptSaid(w, { state: "landed" }), "Sent to bob.near.");
});
