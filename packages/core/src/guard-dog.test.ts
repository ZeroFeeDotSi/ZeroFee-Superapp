// The guard dog's words for a new key (review of ui/a-agent, 5 Nov): an agent_pay key pays from the Safe account itself,
// within Agent's budget (contract agent.rs agent_pay), so the warning says exactly that, and never a daily price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keyWords } from "./guard-dog.ts";
import { ownWalletWords } from "./own-wallet-words.ts";

const ME = "alice.near";
const call = (methods: string[], receiverId = ME) => ({ kind: "function-call" as const, receiverId, methods, allowanceYocto: null });

test("an agent_pay key: never ZeroFee's (AgentZero spends only from its own wallet), it can pay from your Safe; no daily price", () => {
  for (const perDay of [20, 50, null, 0]) {
    const w = keyWords(ME, call(["agent_pay"]), perDay);
    assert.equal(w, "a key not from ZeroFee that can pay from your Safe");
    assert.doesNotMatch(w, /within AgentZero's limits|a day|per day|\$/, "control: the old words made it sound like AgentZero's own");
  }
  // the app's line it matches, and the core gate that makes both true
  const jobs = readFileSync(new URL("../../agent/src/zero/jobs.ts", import.meta.url), "utf8");
  // (AGENTZERO_WALLET on; both states and the one flag: own-wallet-words.test.ts)
  assert.match(jobs, /export const SPENDS_LINE = ownWalletWords\(\)\.spends;/);
  assert.equal(ownWalletWords().spends, "AgentZero spends only from its own wallet.");
  assert.doesNotMatch(jobs, /from your Safe within its limits|can pay from your Safe/, "control: the interim line is gone");
  const door = readFileSync(new URL("./agent-door.ts", import.meta.url), "utf8");
  assert.match(door, /const SAFE_KEY_DOORS = new Set\(\["account\.agent\.set", "account\.agent\.setBudget"/);
  // controls: the other keys keep their own words
  assert.equal(keyWords(ME, { kind: "full" }, null), "a new key that can do anything");
  assert.equal(keyWords(ME, call(["approve"]), null), "a new second device for your account");
  assert.equal(keyWords(ME, call(["x"], "evil.near"), null), "a new key that can use evil.near");
});
