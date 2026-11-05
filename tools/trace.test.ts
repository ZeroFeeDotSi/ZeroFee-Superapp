// The flight recorder's reader (tools/trace.ts): one line per event, a batch that won't open said once. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineOf, linesOf } from "./trace.ts";
import { readerKey, readerKeys, sealBatch } from "../apps/web/src/shell/flight-seal.ts";

const T = new Date(2026, 10, 4, 4, 31, 2, 120).getTime();
const ID = "a".repeat(32);

test("one line per event, as a person reads it", () => {
  assert.equal(lineOf({ t: T, k: "tap", l: "Fund $5" }, "phone"), '04:31:02.120 phone tap "Fund $5"');
  assert.equal(lineOf({ t: T, k: "tap", l: "Hold to send", dis: 1 }, "laptop"), '04:31:02.120 laptop tap "Hold to send" (disabled)');
  assert.equal(lineOf({ t: T, k: "call", m: "account.agent.wallet", ms: 2310, code: "security.request.notAllowed", what: "AgentZero can't do that." }, "phone"), '04:31:02.120 phone call account.agent.wallet 2310ms problem security.request.notAllowed "AgentZero can\'t do that."');
  assert.equal(lineOf({ t: T, k: "call", m: "account.state", ms: 12 }, "phone"), "04:31:02.120 phone call account.state 12ms ok");
  assert.equal(lineOf({ t: T, k: "error", msg: "TypeError: x", at: "send index.js:1:2" }, "phone"), '04:31:02.120 phone error "TypeError: x" at send index.js:1:2');
  assert.equal(lineOf({ t: T, k: "screen", app: "wallet", sheet: "Send" }, "phone"), '04:31:02.120 phone screen wallet sheet "Send"');
});

test("a sealed batch opens to its lines; another trace's (control) is one line saying it won't open", () => {
  const { secret, publicKey } = readerKeys();
  const box = sealBatch(JSON.stringify({ v: 1, src: "phone", seq: 0, ev: [{ t: T, k: "start" }, { t: T, k: "long", ms: 340 }] }), readerKey(publicKey)!, ID);
  assert.deepEqual(linesOf(box, secret, ID), ["04:31:02.120 phone start", "04:31:02.120 phone long task 340ms"]);
  assert.deepEqual(linesOf(box, secret, "b".repeat(32)), ["?? a batch that won't open (another key or another trace)"]);
});
