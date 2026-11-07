// the audit's Trade audit T14 (8 Nov): "Backup words · Written down ✓" was ticked with no proof. SecurityApp started its facts at
// checkDue:false, so Recovery ticked the words (and Quantum read them as checked) from the first frame, before the core's
// account.state answered, and for good when that read failed. Now checkDue starts unknown (null): no tick and no claim
// until the core says the words were checked (ready, no check due); due says "Check them". Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountRowWords, backupWordsShown, wordsCheckedOf } from "./account-rows.ts";

const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");

test("T14: the words tick only on the core's answer that they were checked; not said yet, nothing", () => {
  assert.deepEqual(backupWordsShown(null), { value: "", tick: false }, "first open, or the read failed: no tick, no claim");
  assert.deepEqual(backupWordsShown(true), { value: "Check them", tick: false });
  assert.deepEqual(backupWordsShown(false), { value: "Written down", tick: true }, "control: checked");
});

test("T14: Quantum's words row reads checked only from the core's answer", () => {
  assert.equal(wordsCheckedOf(true, null), null, "not said yet");
  assert.equal(wordsCheckedOf(true, false), true);
  assert.equal(wordsCheckedOf(true, true), false, "due");
  assert.equal(wordsCheckedOf(false, false), false, "no words key on the account");
});

test("T14: the facts start unknown, and Recovery and Quantum read them through these (wiring)", () => {
  assert.match(src, /let lastFacts: Facts = \{ devices: null, mainUsd: 0, checkDue: null,/);
  assert.doesNotMatch(src, /checkDue: false, fresh: null/, "control: the old start, ticked before any answer");
  assert.match(src, /wordsChecked=\{wordsCheckedOf\(account\.keys\.some\(\(k\) => k\.role === "recovery"\), facts\.checkDue\)\}/);
  assert.match(src, /const w = backupWordsShown\(checkDue\);/);
  assert.match(src, /function RecoveryTab\(\{ account, actions, checkDue = null,/);
  // Your account's Recovery row: "Check" only when due; unknown is its plain name, never a tick
  const base = { web: false, quantumOn: true, protection: true, pending: false };
  assert.equal(accountRowWords({ ...base, checkDue: null }).recovery.value, "Backup words");
  assert.equal(accountRowWords({ ...base, checkDue: true }).recovery.value, "Check");
});
