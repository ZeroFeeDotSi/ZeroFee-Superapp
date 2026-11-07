// the audit's Trade audit T15 (8 Nov): Quantum-safe listed "Your laptop · Not yet" and "AgentZero · Not yet" for an account with
// no laptop and no AgentZero key, under "Your Safe's keys are built to resist the computers of the future.". Now a row is
// listed only for a key the account has (the backup words stay: every account has them, and "Not yet" there is a real
// to-do). Controls: an old (classical) laptop key still shows its row as not safe; the card's On is unchanged. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountKeyInfo } from "@zerofee/core/signer";
import { QUANTUM_WORDS, quantumOf, quantumRowsShown } from "./quantum.ts";

const PHONE: AccountKeyInfo = { handle: "ml-dsa-65-hash:Phone", role: "device", kind: "secure-chip", current: true, access: "full" };
const WORDS: AccountKeyInfo = { handle: "ml-dsa-65-hash:Words", role: "recovery", kind: "recovery-words", access: "function-call" };
const AGENT: AccountKeyInfo = { handle: "ml-dsa-65-hash:Agent", role: "agent", kind: "development", access: "function-call" };
const LAPTOP: AccountKeyInfo = { handle: "ml-dsa-65-hash:Laptop", role: "second-device", kind: "development", access: "function-call" };
const OLD_LAPTOP: AccountKeyInfo = { handle: "ed25519:Laptop", role: "second-device", kind: "development", access: "function-call" };

test("T15: no laptop and no AgentZero key: no row for either, and no \"Not yet\" under the On line", () => {
  const q = quantumOf([PHONE, WORDS]);
  assert.equal(q.on, true);
  assert.deepEqual(q.rows.map((r) => r.id), ["phone", "words"]);
  for (const web of [false, true]) assert.ok(!quantumRowsShown(q.rows, web, true).some((r) => r.value === QUANTUM_WORDS.notYet), `web ${web}`);
});

test("T15 controls: each key on the account keeps its row; an old laptop key reads Not yet; no words key still says so", () => {
  assert.deepEqual(quantumOf([PHONE, WORDS, LAPTOP, AGENT]).rows.map((r) => [r.id, r.safe]), [["phone", true], ["laptop", true], ["words", true], ["agent", true]]);
  const old = quantumOf([PHONE, WORDS, OLD_LAPTOP]);
  assert.deepEqual(old.rows.map((r) => [r.id, r.safe]), [["phone", true], ["laptop", false], ["words", true]]);
  assert.equal(quantumRowsShown(old.rows, false).find((r) => r.id === "laptop")!.value, QUANTUM_WORDS.notYet);
  assert.equal(quantumRowsShown(quantumOf([PHONE]).rows, false).find((r) => r.id === "words")!.value, QUANTUM_WORDS.notYet, "the words are every account's");
});
