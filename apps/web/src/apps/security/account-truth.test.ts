// the audit's MUST and the copy review's S1, S3, #7 (7 Nov): what Your account and Quantum-safe SAY on the web vs on the phone. Nothing here
// changes what quantumOf decides; only the claims. Each case failed on main (quantumRowsShown and accountRowWords did not
// exist: the sheet drew r.line and a tick from quantumOf's rows, so the web Sim said "In its secure chip" with a tick).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AccountKeyInfo } from "@zerofee/core/signer";
import { QUANTUM_WORDS, quantumOf, quantumRowsShown } from "./quantum.ts";
import { accountRowWords } from "./account-rows.ts";

const CHIP: AccountKeyInfo = { handle: "ml-dsa-65-hash:Phone", role: "device", kind: "secure-chip", current: true, access: "full" };
const DEV: AccountKeyInfo = { ...CHIP, kind: "development" };
const WORDS: AccountKeyInfo = { handle: "ml-dsa-65-hash:Words", role: "recovery", kind: "recovery-words", access: "function-call" };
const AGENT: AccountKeyInfo = { handle: "ml-dsa-65-hash:Agent", role: "agent", kind: "development", access: "function-call" };

const shown = (keys: AccountKeyInfo[], web: boolean, checked: boolean | null = true) =>
  Object.fromEntries(quantumRowsShown(quantumOf(keys, web ? "This device" : "This phone").rows, web, checked).map((r) => [r.id, r]));

test("web: no secure-chip line and no tick for this device or AgentZero, whatever kind the key reports (chip, development)", () => {
  for (const device of [CHIP, DEV]) {
    const r = shown([device, WORDS, AGENT], true);
    assert.equal(r.phone!.line, undefined, `${device.kind}: never "In its secure chip" on the web`);
    assert.deepEqual([r.phone!.value, r.phone!.tick], ["On iPhone", false], device.kind);
    assert.deepEqual([r.agent!.value, r.agent!.tick], ["On iPhone", false], device.kind);
    assert.equal(r.laptop, undefined, "the audit's T15: no laptop key on the account, no row");
  }
});

test("web: the backup words read \"Written down\", ticked only when checked; no words key reads Not yet", () => {
  assert.deepEqual([shown([CHIP, WORDS], true, true).words!.value, shown([CHIP, WORDS], true, true).words!.tick], ["Written down", true]);
  assert.deepEqual([shown([CHIP, WORDS], true, false).words!.value, shown([CHIP, WORDS], true, false).words!.tick], ["Written down", false]);
  assert.deepEqual([shown([CHIP, WORDS], true, null).words!.tick], [false], "not read yet: no tick");
  assert.deepEqual([shown([CHIP], true).words!.value, shown([CHIP], true).words!.tick], ["Not yet", false]);
});

test("control, the phone: its real chip key keeps \"In its secure chip\" and every on-account ML-DSA key its tick", () => {
  const r = shown([CHIP, WORDS, AGENT], false, false);
  assert.equal(r.phone!.line, "In its secure chip");
  assert.deepEqual([r.phone!.tick, r.words!.tick, r.agent!.tick], [true, true, true]);
  assert.equal(r.phone!.value, null);
  assert.equal(r.laptop, undefined, "the audit's T15: no laptop key, no \"Not yet\" row");
  assert.equal(shown([DEV, WORDS], false).phone!.line, undefined, "control: a development key on the phone claims no chip");
});

test("the sheet draws only quantumRowsShown's words, and On folds the headline into one body line (the copy review's S1)", () => {
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  const sheet = src.slice(src.indexOf("function QuantumSheet"), src.indexOf("/** What the account itself did"));
  assert.match(sheet, /const shown = quantumRowsShown\(q\.rows, !phone, wordsChecked\);/);
  assert.match(sheet, /\{shown\.map\(\(r\) =>/);
  assert.doesNotMatch(sheet, /q\.rows\.map|headOn/, "the old rows and headline are gone");
  assert.match(sheet, /\{!q\.on && <h2/);
  assert.equal(QUANTUM_WORDS.bodyOn, "Your Safe's keys are built to resist the computers of the future.");
});

test("Your account's right sides: never \"On\" on the web (the copy review's S3, #7); the phone keeps its On", () => {
  const base = { quantumOn: true, protection: true, pending: false, checkDue: false };
  const web = accountRowWords({ ...base, web: true });
  assert.deepEqual([web.quantum, web.protection, web.recovery.value, web.recovery.line], ["On iPhone", "Your rules", "Written down", undefined]);
  for (const v of [web.quantum, web.protection, web.recovery.value]) assert.notEqual(v, "On");
  const phone = accountRowWords({ ...base, web: false });
  assert.deepEqual([phone.quantum, phone.protection, phone.recovery.value, phone.recovery.line], ["On", "On", "Written down", undefined], "control: the phone's On is true there");
  // the states that ask for something say so on both
  for (const w of [true, false]) {
    const ask = accountRowWords({ web: w, quantumOn: false, protection: false, pending: false, checkDue: true });
    assert.deepEqual([ask.quantum, ask.protection, ask.recovery.value, ask.recovery.line], ["Fix", "Add", "Check", "Check your backup words"]);
    assert.deepEqual(accountRowWords({ web: w, quantumOn: null, protection: null, pending: true, checkDue: false }), { quantum: "", protection: "", recovery: { line: "A new device is waiting", value: "Stop it" } });
  }
});

test("Recovery's backup-words row says \"Written down\" with its tick once checked, never \"On\" (the copy review's #7; control: due, \"Check them\")", () => {
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  // the audit's T14: the words come from backupWordsShown (words-tick.test.ts: "Written down" ticked only on the core's answer)
  assert.match(src, /<span>Backup words<\/span><span className="v">\{\(\(\) => \{ const w = backupWordsShown\(checkDue\); return w\.tick \? <>\{w\.value\} <span className="zf-tick on/);
  assert.doesNotMatch(src, /"Check them" : <>On </, "fails before: \"On\" with a tick");
});
