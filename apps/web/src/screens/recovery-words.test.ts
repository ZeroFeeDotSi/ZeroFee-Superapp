import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceLine, fallbackSeconds, floorSeconds, newPhoneWait, oldPhoneCount, phoneCanStop, recoveryFacts, waitName, whoCanStop, wordsBack } from "./recovery-words.ts";
import { securityProblems } from "@zerofee/core/security-problems";

const H = 3600, D = 86_400;
const CHOICES = [{ seconds: D, default: false }, { seconds: 2 * D, default: true }, { seconds: 3 * D, default: false }, { seconds: 7 * D, default: false }];

test("release 7's numbers: the floor and the words-only fallback, per choice (lib.rs)", () => {
  assert.deepEqual(CHOICES.map((c) => waitName(floorSeconds(c.seconds))), ["48 hours", "3 days", "4 days", "8 days"]);
  assert.deepEqual(CHOICES.map((c) => waitName(fallbackSeconds(c.seconds))), ["7 days", "7 days", "9 days", "21 days"]);
  assert.equal(fallbackSeconds(30 * D), 30 * D, "never longer than 30 days");
  assert.equal(waitName(60), "1 minute");
  assert.equal(waitName(24 * H), "24 hours");
});

test("the set-up choice: one line each, what a change then waits, and never 'Recommended' (grade 1 Nov c, P9)", () => {
  assert.deepEqual(CHOICES.map((c) => choiceLine(c, CHOICES)), [
    "The quickest way back. Changes to your rules wait 48 hours.",
    "Changes to your rules wait 3 days.",
    "Changes to your rules wait 4 days.",
    "The most time to stop a stranger. Changes to your rules wait 8 days.",
  ]);
});

const now = Date.UTC(2026, 9, 29, 12);
const at = (s: number) => new Date(now + s * 1000).toISOString();
const when = (iso: string) => `[${iso}]`;

test("the new phone with a second device of age: waiting for its yes, the countdown to the delay, the account's own fallback", () => {
  const w = newPhoneWait({ readyAtIso: at(2 * D), needsSecondDevice: true, approved: false, fallbackAtIso: at(7 * D), canFinishAtIso: at(7 * D) }, 2 * D, now, when);
  assert.equal(w.label, "Waiting for your second device");
  assert.equal(w.untilIso, at(2 * D));
  assert.match(w.body, /must say yes.*after 48 hours/);
  assert.equal(w.fallback, `Lost your second device too? Then you can finish without it after 7 days, on [${at(7 * D)}].`);
  assert.equal(w.ready, false);
  // The delay is over without a yes: the count goes on to the fallback.
  const later = newPhoneWait({ readyAtIso: at(-1), needsSecondDevice: true, approved: false, fallbackAtIso: at(5 * D), canFinishAtIso: at(5 * D) }, 2 * D, now, when);
  assert.equal(later.untilIso, at(5 * D));
  assert.doesNotMatch(later.body, /wait is over/, "never 'the wait is over' beside a countdown");
});

test("grade 30 Oct item 1: the fallback is counted from the move's start, so a skipped wait never grows it (7, 7, 9, 21 days)", () => {
  for (const [delay, days] of [[D, 7], [2 * D, 7], [3 * D, 9], [7 * D, 21]] as const) {
    const fb = at(fallbackSeconds(delay));
    // before and after "Skip ahead" (the ready time moved to now, the fallback stayed)
    for (const readyAtIso of [at(delay), at(0), at(-1)]) {
      const w = newPhoneWait({ readyAtIso, needsSecondDevice: true, approved: false, fallbackAtIso: fb, canFinishAtIso: fb }, delay, now, when);
      assert.equal(w.fallback, `Lost your second device too? Then you can finish without it after ${days} days, on [${fb}].`, `${delay} ${readyAtIso}`);
    }
  }
});

test("after the yes, the new phone and the old phone agree: only the second device can stop it", () => {
  const yes = newPhoneWait({ readyAtIso: at(D), needsSecondDevice: true, approved: true, fallbackAtIso: at(6 * D), canFinishAtIso: at(D) }, 2 * D, now, when);
  assert.match(yes.body, /Only your second device can stop it/);
  assert.match(whoCanStop({ needsSecondDevice: true, approved: true }), /only it can stop it now/);
});

test("the old phone after the delay without a yes: no 'finish in 0s', the count is to the fallback", () => {
  const c = oldPhoneCount({ readyAtIso: at(-1), needsSecondDevice: true, approved: false, fallbackAtIso: at(5 * D) }, "your laptop", now);
  assert.equal(c.untilIso, at(5 * D));
  assert.equal(c.before, "It can finish now if your laptop says yes. Without it, it finishes in ");
});

test("the new phone after the yes, when it can finish, and with no second device", () => {
  const yes = newPhoneWait({ readyAtIso: at(D), needsSecondDevice: true, approved: true, fallbackAtIso: at(6 * D), canFinishAtIso: at(D) }, 2 * D, now, when);
  assert.equal(yes.label, "Your second device said yes");
  assert.equal(yes.untilIso, at(D));
  assert.equal(yes.fallback, null);
  const ready = newPhoneWait({ readyAtIso: at(-5), needsSecondDevice: true, approved: true, fallbackAtIso: at(6 * D), canFinishAtIso: at(-5) }, 2 * D, now, when);
  assert.equal(ready.ready, true);
  const alone = newPhoneWait({ readyAtIso: at(D) }, 2 * D, now, when);
  assert.equal(alone.label, "On its way");
  assert.equal(alone.ready, false);
});

test("the old phone: who can stop it, and the countdown", () => {
  assert.equal(whoCanStop({ needsSecondDevice: true }), "Your second device can refuse it any time. This device can ask to stop it once.");
  assert.equal(whoCanStop({ needsSecondDevice: true, approved: true }), "Your second device said yes to this move: only it can stop it now.");
  assert.equal(whoCanStop({ needsSecondDevice: true, stopAtIso: at(D) }, when), `This device asked to stop it. It stops [${at(D)}], or at once if your second device says yes.`);
  assert.deepEqual([phoneCanStop({ needsSecondDevice: true }), phoneCanStop({ needsSecondDevice: true, approved: true }), phoneCanStop({ needsSecondDevice: true, stopAtIso: at(D) }), phoneCanStop({})], [true, false, false, true]);
  assert.equal(whoCanStop({}), "This device can stop it.");
  assert.deepEqual(oldPhoneCount({ readyAtIso: at(D), needsSecondDevice: true, approved: false }), { untilIso: at(D), before: "It can finish in ", after: ", only if your second device says yes.", atZero: "It can finish now if your second device says yes." });
  // never "It finishes in 0s" (grade 1 Nov, item 7): each count has its own words for when it reaches nothing
  assert.equal(oldPhoneCount({ readyAtIso: at(D), needsSecondDevice: true, approved: true }, "your laptop").atZero, "Your laptop said yes. It can finish now.");
  assert.doesNotMatch(oldPhoneCount({ readyAtIso: at(D) }).atZero, /\b0s\b|in $/);
  assert.equal(oldPhoneCount({ readyAtIso: at(D) }).after, " unless you stop it.");
});

test("Security's facts: the chosen wait, the second device, the fallback only where a device is needed", () => {
  assert.deepEqual(recoveryFacts(2 * D, "ready").map((f) => `${f.label}: ${f.value}`), [
    "Recovery wait: 48 hours, chosen at set-up",
    "Second device: Needed for a move",
    "If you lose it too: Your words alone, after 7 days",
    "Changes to your rules wait: 3 days",
  ]);
  assert.equal(recoveryFacts(D, "none").some((f) => f.label === "If you lose it too"), false);
  // Grade 02f, F2: a 1-minute test wait with a held "Approve + 1-hour wait" band: a change waits 1 hour (59m 57s on
  // chain), never the floor's 2 minutes; unread, the row waits for the rules instead of guessing.
  const change = (f: { label: string; value: string }[]) => f.find((x) => x.label === "Changes to your rules wait")?.value;
  assert.equal(change(recoveryFacts(60, "none", 3600)), "1 hour");
  assert.equal(change(recoveryFacts(60, "none", 0)), "2 minutes", "control: no band wait, the floor");
  assert.equal(change(recoveryFacts(60, "none", null)), undefined);
  assert.equal(choiceLine({ seconds: 60, default: true }, [{ seconds: 60, default: true }], 3600).endsWith("wait 1 hour."), true);
});

test("02e, E1: words come back called wrong only when the core said so; a decline or the network calls none wrong", () => {
  assert.deepEqual(wordsBack(securityProblems.recoveryDeclined()), {});
  assert.deepEqual(wordsBack(securityProblems.nodesUnreachable()), {});
  assert.deepEqual(wordsBack({ code: "x", whatHappened: "", money: { state: "not-involved" }, next: { kind: "fix-input", label: "Check word 7", field: "word-7" } }), { badWord: 7 });
  assert.deepEqual(wordsBack({ code: "x", whatHappened: "", money: { state: "not-involved" }, next: { kind: "fix-input", label: "Check your words", field: "words" } }), { wrong: true });
});

test("02g, F21: a word that isn't a backup word gets the closest ones; a real word gets none", async () => {
  const { closeWords } = await import("./word-entry.ts");
  assert.equal(closeWords("searchx")[0], "search");
  assert.equal(closeWords("abandn")[0], "abandon");
  assert.equal(closeWords("wrold").includes("world"), true, "two letters swapped");
  assert.deepEqual(closeWords("search"), [], "control: a backup word needs no suggestion");
  assert.deepEqual(closeWords("qqqqqqq"), [], "nothing close: nothing made up");
});

test("02g, F2: set-up, the Recovery tab and Protection say the rules-change wait with one function, and set-up says a longer band wait lengthens it", async () => {
  const { ruleChangeWaitWords, changeRuleWords } = await import("../apps/security/rules.ts");
  const { CHOICE_WORDS } = await import("./recovery-words.ts");
  const w = { name: "Approve", level: "Approve" } as never;
  // A 1-minute test account: new (2-minute band) waits 2 minutes; after its big payments wait 1 hour, every change waits 1 hour.
  assert.equal(ruleChangeWaitWords(120, 60), "2 minutes");
  assert.equal(ruleChangeWaitWords(3600, 60), "1 hour");
  assert.match(choiceLine({ seconds: 60, default: false }, [{ seconds: 60, default: false }, { seconds: 2 * D, default: true }], 120), /wait 2 minutes\.$/);
  assert.match(CHOICE_WORDS.later, /Rule changes always wait at least this long/);
  assert.equal(recoveryFacts(60, "none", 3600).find((f) => f.label === "Changes to your rules wait")!.value, "1 hour");
  assert.match(changeRuleWords([{ upToUsd: 490, level: "faceid", waitSeconds: 3600 }, { upToUsd: null, level: "wait", waitSeconds: 3600 }], 60, w), /waits 1 hour\./);
  // 24-hour accounts: one word for the floor everywhere ("48 hours", never "2 days" on one screen and "48 hours" on another).
  assert.equal(ruleChangeWaitWords(0, D), "48 hours");
  assert.match(changeRuleWords([{ upToUsd: null, level: "faceid", waitSeconds: 0 }], D, w), /waits 48 hours\./);
});
