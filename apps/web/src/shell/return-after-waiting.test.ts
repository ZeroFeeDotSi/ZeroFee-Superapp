import { test } from "node:test";
import assert from "node:assert/strict";
import { returnAfterWaiting } from "./return-after-waiting.ts";

test("a held send started in Wallet (Send opens Pay): Done on the Waiting screen returns to Wallet's Activity, not Pay's set-up", () => {
  assert.deepEqual(returnAfterWaiting("pay", "wallet"), { app: "wallet", tab: "activity" });
});

test("another app's hand-off goes back to that app; a hold made in the app itself stays there", () => {
  assert.deepEqual(returnAfterWaiting("pay", "trade"), { app: "trade" });
  assert.equal(returnAfterWaiting("pay", undefined), null);
  assert.equal(returnAfterWaiting("pay", "pay"), null);
});
