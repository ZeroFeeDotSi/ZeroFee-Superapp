// QA's condition (ui/a-agent 86cc69623, 5 Nov): the "spends only from its own wallet" lines and the key alert
// switch on the SAME flag (AGENTZERO_WALLET), the app's and the relay's alike; off, the Safe-limit words come back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENTZERO_WALLET } from "./agent-route.ts";
import { ownWalletWords } from "./own-wallet-words.ts";
import { keyWords } from "./guard-dog.ts";
import { keyWords as relayKeyWords } from "../../../apps/quotes/alerts.mjs";
import { AGENTZERO_WALLET as RELAY_WALLET } from "../../../apps/quotes/agentzero-chat.mjs";

const ME = "alice.near";
const agentKey = { kind: "function-call" as const, receiverId: ME, methods: ["agent_pay"], allowanceYocto: null };
const relayAgentKey = { FunctionCall: { receiver_id: ME, method_names: ["agent_pay"], allowance: null } };

test("on: every line says its own wallet only, and a new agent_pay key is not ZeroFee's", () => {
  const w = ownWalletWords(true);
  for (const l of [w.turnsOn, w.spends, w.askOff, w.sheet, w.row!]) assert.match(l, /only from (its own wallet|here)|from its own wallet/, l);
  assert.equal(w.fund, "AgentZero never spends from your Safe or your other wallets.");
  assert.equal(keyWords(ME, agentKey, null, true), "a key not from ZeroFee that can pay from your Safe");
  assert.equal(relayKeyWords(ME, relayAgentKey, null, true), keyWords(ME, agentKey, null, true), "the relay says the same");
  for (const l of Object.values(w)) assert.doesNotMatch(String(l), /within (its|AgentZero's) limits/, "control: no Safe-limit words while on");
});

test("off: the Safe-limit words and the old alert, never 'only from its own wallet'", () => {
  const w = ownWalletWords(false);
  assert.equal(w.turnsOn, "This turns on AgentZero. It can pay from your Safe, within its limits.");
  assert.equal(w.spends, "AgentZero can pay from your Safe, within its limits.");
  assert.equal(w.row, null);
  assert.equal(keyWords(ME, agentKey, null, false), "a new key that can pay from your Safe, within AgentZero's limits");
  assert.equal(relayKeyWords(ME, relayAgentKey, null, false), keyWords(ME, agentKey, null, false), "the relay says the same");
  for (const l of Object.values(w)) assert.doesNotMatch(String(l), /only from|never spends from your Safe|not from ZeroFee/, "control: no own-wallet words while off");
});

test("one flag drives them all: the defaults follow AGENTZERO_WALLET, the relay's copy is the same flag, and no line is hard-coded elsewhere", () => {
  assert.equal(RELAY_WALLET, AGENTZERO_WALLET);
  assert.deepEqual(ownWalletWords(), ownWalletWords(AGENTZERO_WALLET));
  assert.equal(keyWords(ME, agentKey, null), ownWalletWords(AGENTZERO_WALLET).keyAlert);
  assert.equal(relayKeyWords(ME, relayAgentKey, null), ownWalletWords(AGENTZERO_WALLET).keyAlert);
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const users = { jobs: read("../../agent/src/zero/jobs.ts"), fund: read("../../agent/src/app/fund-words.ts"), app: read("../../agent/src/app/AgentApp.tsx"), mock: read("../../shell-api/src/MockBridge.ts"), guard: read("./guard-dog.ts") };
  for (const [name, src] of Object.entries(users)) {
    assert.match(src, /ownWalletWords\(/, `${name} reads the words from the flag`);
    for (const l of [...Object.values(ownWalletWords(true)), ...Object.values(ownWalletWords(false))]) if (l) assert.ok(!src.includes(`"${l}"`), `${name} hard-codes "${l}"`);
  }
});
