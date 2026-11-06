// AgentZero's chat words with its own wallet on (AGENTZERO-WALLET.md L8): the prompt and propose_act offer only "agent"
// (AgentZero's wallet), in BOTH copies, word for word: the app's (tools.ts, the person's own key) and the relay's
// (apps/quotes/agentzero-chat.mjs, the free reading). Off (today), both exactly as before. The two copies' switches are
// one: a test holds the relay's AGENTZERO_WALLET to the app's. Control: leave a person's wallet among the places with the
// switch on, or let one copy drift, and these go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTZERO_WALLET } from "@zerofee/core/agent-route";
import { JOB_SCHEMA } from "../zero/rulebox.ts";
import { ACT_PLACES, actPlaces, CHAT_SYSTEM, CHAT_TOOLS, chatSystem, chatTools } from "./tools.ts";
// @ts-ignore: plain JS, deployed as is
import { AGENTZERO_WALLET as RELAY_WALLET, CHAT_SYSTEM as RELAY_SYSTEM, chatSystem as relaySystem, chatTools as relayTools } from "../../../../apps/quotes/agentzero-chat.mjs";

const act = (tools: { name: string; description: string; input_schema: any }[]) => tools.find((t) => t.name === "propose_act")!;

test("the relay's switch is the app's: both on (product decision, 3 Nov), and they flip together", () => {
  assert.equal(AGENTZERO_WALLET, true);
  assert.equal(RELAY_WALLET, AGENTZERO_WALLET);
});

test("both copies are word for word the same, the switch off and on", () => {
  for (const on of [false, true]) {
    assert.equal(chatSystem(on), relaySystem(on), `system, wallet ${on}`);
    assert.deepEqual(JSON.parse(JSON.stringify(chatTools(JOB_SCHEMA, on))), JSON.parse(JSON.stringify(relayTools(JOB_SCHEMA, on))), `tools, wallet ${on}`);
  }
  assert.equal(CHAT_SYSTEM, RELAY_SYSTEM);
});

test("on: propose_act offers only AgentZero's wallet, from and to; the prompt says it acts only from its own wallet", () => {
  for (const [name, tools, system] of [["app", chatTools(JOB_SCHEMA, true), chatSystem(true)], ["relay", relayTools(JOB_SCHEMA, true), relaySystem(true)]] as const) {
    const a = act(tools as never);
    assert.deepEqual(a.input_schema.properties.from.enum, ["agent"], name);
    assert.deepEqual(a.input_schema.properties.to.enum, ["agent"], name);
    assert.match(a.description, /from AgentZero's own wallet/, name);
    assert.doesNotMatch(a.description, /\b(spending|sol|hood|bsc|safe) \(/, `${name}: no person's place is offered`);
    assert.match(system, /acts and trades only from that wallet, never from the person's Safe or wallets/, name);
    const job = (tools as { name: string; description: string }[]).find((t) => t.name === "propose_job")!;
    assert.match(job.description, /buying from AgentZero's own wallet; sign in to sites/, name);
  }
  assert.deepEqual(actPlaces(true), ["agent"]);
});

test("on (product decision, 3 Nov): the shipped places, prompt and tools are the wallet's; explicitly off they are as they were", () => {
  assert.deepEqual(ACT_PLACES, ["agent"]);
  assert.equal(CHAT_SYSTEM, chatSystem(true));
  assert.deepEqual(actPlaces(false), ["spending", "sol", "hood", "bsc", "safe"]);
  assert.deepEqual(act(CHAT_TOOLS as never).input_schema.properties.from.enum, ["agent"]);
  assert.doesNotMatch(chatSystem(false), /its own wallet \(place agent\)/);
  assert.deepEqual(act(chatTools(JOB_SCHEMA, false) as never).input_schema.properties.from.enum, ["spending", "sol", "hood", "bsc", "safe"]);
  assert.match(act(chatTools(JOB_SCHEMA, false) as never).description, /Places: spending \(their NEAR wallet, its dollars\)/);
});
