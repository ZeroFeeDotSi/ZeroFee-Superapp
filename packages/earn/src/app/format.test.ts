import { test } from "node:test";
import assert from "node:assert/strict";
import { agoText, forecastText, nearText, rateSpan, shareOf, startAmount, usdText, waitSpan, whenText } from "./format.ts";

test("NEAR is shown rounded down, never more than there is", () => {
  assert.equal(nearText("112.4099"), "112.40");
  assert.equal(nearText("6384397.129"), "6,384,397.12");
  assert.equal(nearText("50"), "50.00");
  assert.equal(nearText("0.05189"), "0.0518");
  assert.equal(nearText("0"), "0");
  assert.equal(usdText("112.4", 4.39), "$493.43");
  assert.equal(usdText("1", undefined), undefined);
});

test("a rate says the span it was measured over, and a forecast is worded as one", () => {
  assert.deepEqual(rateSpan({ percent: "5.15", days: 0.6 }), { at: "today's rate", over: "last 14 hours" });
  assert.deepEqual(rateSpan({ percent: "5.37", days: 29.8 }), { at: "the last 30 days' rate", over: "last 30 days" });
  assert.deepEqual(rateSpan({ percent: "5.2", days: 6.4 }), { at: "the last 6 days' rate", over: "last 6 days" });
  assert.equal(forecastText("112.4", { percent: "5.37", days: 0.6 }, 4.39), "At today's rate: about $26.49 a year");
  assert.equal(forecastText("10", { percent: "5", days: 0.6 }), "At today's rate: about 0.5 NEAR a year");
});

test("waits and ages in plain words", () => {
  const now = Date.parse("2026-10-25T10:00:00Z");
  assert.equal(whenText("2026-10-26T05:10:00Z", now), "in about 20 hours");
  assert.equal(whenText("2026-10-25T10:20:00Z", now), "in less than an hour");
  assert.equal(whenText("2026-10-28T10:00:00Z", now), "in about 3 days");
  assert.equal(whenText("2026-10-25T09:00:00Z", now), "now");
  assert.equal(agoText("2026-10-25T01:00:00Z", now), "9 h");
  assert.equal(agoText("2026-10-23T10:00:00Z", now), "2 days");
});

test("presets are a share of the amount, rounded down to 4 decimals", () => {
  assert.equal(shareOf("112.4", 25), "28.1");
  assert.equal(shareOf("112.4", 50), "56.2");
  assert.equal(shareOf("0.33333", 50), "0.1666");
  assert.equal(shareOf("112.4", 100), "112.4");
});

test("the wait for NEAR asked back is read from the epoch, never a fixed figure", () => {
  assert.equal(waitSpan({ epochHours: 6.9, minHours: 20.6, maxHours: 27.5, ifNowIso: "2026-10-26T10:00:00.000Z" }), "about a day (21 to 28 hours)");
  assert.equal(waitSpan({ epochHours: 12, minHours: 36, maxHours: 48, ifNowIso: "2026-10-26T10:00:00.000Z" }), "about 2 days (36 to 48 hours)");
  assert.equal(waitSpan(undefined), "about a day", "until the epoch is read");
});

test("a stake starts at the account's own NEAR, never the spending balance in NEAR Intents", () => {
  const idle = { account: "40.123456789", accountWrapped: "2", ledger: "70", total: "112.123456789", reserve: "0.05" };
  assert.equal(startAmount(idle), "40.1234", "the account's own NEAR, rounded down to 4 decimals");
  assert.equal(startAmount({ ...idle, account: "0" }), "0", "nothing on the account: the person picks");
});
