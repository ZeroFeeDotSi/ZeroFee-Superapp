// Dead ends row 21 (3 Nov): a failed AgentZero turn names its cause and keeps "Nothing moved." Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failLine, withMoney } from "./fail-line.ts";

const api = (status: number, message = "x") => Object.assign(new Error(message), { status, name: "APIError" });

test("each cause by name, with Nothing moved.", () => {
  assert.equal(failLine(new TypeError("Failed to fetch"), false), "This phone can't reach Claude. Check it's online. Nothing moved.");
  assert.equal(failLine(new TypeError("Failed to fetch dynamically imported module: /assets/sdk.js"), true), "This phone can't reach Claude. Check it's online. Nothing moved.", "the SDK's chunk didn't load");
  assert.equal(failLine(api(401), true), "Claude didn't accept your key. Change it in Settings. Nothing moved.");
  assert.equal(failLine(api(403), true), "Claude didn't accept your key. Change it in Settings. Nothing moved.");
  assert.equal(failLine(api(400, "Your credit balance is too low"), true), "Your Claude account has no credit left. Add some at Anthropic. Nothing moved.");
  assert.equal(failLine(api(429), true), "Claude is busy. Try again in a minute. Nothing moved.");
  assert.equal(failLine(api(529), true), "Claude is down right now. Try again soon. Nothing moved.");
  assert.equal(failLine(api(500), true), "Claude is down right now. Try again soon. Nothing moved.");
  // controls: an unknown failure keeps the old meaning (with a next step); a 400 not about credit isn't "no credit"
  assert.equal(failLine(new Error("boom"), true), "AgentZero didn't answer. Try again. Nothing moved.");
  assert.equal(failLine(api(400, "bad request"), true), "AgentZero didn't answer. Try again. Nothing moved.");
  assert.equal(failLine(undefined, true), "AgentZero didn't answer. Try again. Nothing moved.");
});

test("Nothing moved. is said once, never twice", () => {
  assert.equal(withMoney("Claude didn't answer."), "Claude didn't answer. Nothing moved.");
  assert.equal(withMoney("Stopped. Nothing else ran."), "Stopped. Nothing else ran.");
  assert.equal(withMoney("The relay didn't answer. Nothing was sent."), "The relay didn't answer. Nothing was sent.");
  assert.equal(withMoney(withMoney("Claude is busy.")), "Claude is busy. Nothing moved.");
});

test("the phone's chat and the screen use it: the one generic line for every failure is gone", () => {
  const generic = /"AgentZero didn't answer\. Nothing moved\."/;
  // the Sim's chat makes its answers itself (sim-chat.ts: no turn, nothing to fail)
  for (const f of ["./live-chat.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, generic, f);
    assert.match(src, /failLine\(e\)/, f);
  }
  // control: main's line is caught by the same check
  assert.match('parts: [{ type: "fault", line: "AgentZero didn\'t answer. Nothing moved." }]', generic);
});
