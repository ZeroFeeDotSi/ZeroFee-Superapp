import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeNotice } from "./freeze.ts";

const now = Date.UTC(2026, 9, 28, 12);
const later = new Date(now + 8 * 86_400_000).toISOString();
const when = (iso: string) => `[${iso}]`;

test("no banner unless payments are frozen now (release 6 says until when; older releases say nothing)", () => {
  assert.equal(freezeNotice(null, now, when), null);
  assert.equal(freezeNotice({ pending: null }, now, when), null);
  assert.equal(freezeNotice({ pending: null, frozenUntilIso: null }, now, when), null);
  assert.equal(freezeNotice({ pending: null, frozenUntilIso: new Date(now - 1).toISOString() }, now, when), null);
  assert.equal(freezeNotice({ pending: { readyAtIso: later } }, now, when), null, "a v5 account: its alert screen, no banner");
});

test("while a recovery waits with no second device: this phone can cancel it, the countdown to the finish", () => {
  assert.deepEqual(freezeNotice({ pending: { readyAtIso: later }, frozenUntilIso: later }, now, when), {
    recovering: true,
    canStop: true,
    text: "Someone started moving your account to a new device.",
    who: "This device can stop it.",
    count: { untilIso: later, before: "Finishes in ", after: " unless you stop it.", atZero: "It can finish now unless you stop it." },
    also: `Payments wait until [${later}]. Not you? Stop it, then get new words.`,
  });
});

test("release 7, with a second device of age: it can refuse, and the move can finish only with its yes", () => {
  const ready = new Date(now + 2 * 86_400_000).toISOString();
  const n = freezeNotice({ pending: { readyAtIso: ready, needsSecondDevice: true, approved: false, fallbackAtIso: later, canFinishAtIso: later }, frozenUntilIso: later }, now, when)!;
  assert.equal(n.who, "Your second device can refuse it any time. This device can ask to stop it once.");
  // This phone's one stop waits (re-audit 7): said, with when, and no second Stop it.
  const asked = freezeNotice({ pending: { readyAtIso: ready, needsSecondDevice: true, approved: false, stopAtIso: ready }, frozenUntilIso: later }, now, when)!;
  assert.equal(asked.who, `This device asked to stop it. It stops [${ready}], or at once if your second device says yes.`);
  assert.equal(asked.canStop, false);
  assert.deepEqual(n.count, { untilIso: ready, before: "It can finish in ", after: ", only if your second device says yes.", atZero: "It can finish now if your second device says yes." });
});

test("after one was stopped: stopped, until when, and why new words", () => {
  const n = freezeNotice({ pending: null, frozenUntilIso: later }, now, when)!;
  assert.equal(n.recovering, false);
  assert.equal(n.text, `A move to a new device has stopped. Payments wait until [${later}].`);
  assert.match(n.also, /Get new words\.$/);
});
