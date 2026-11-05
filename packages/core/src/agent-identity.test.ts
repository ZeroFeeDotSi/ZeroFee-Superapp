// A-10: AgentZero's own name, agent.<you>.near: only for a named account; only once the account's release can make it;
// on the core's sheet; an identity, never a pot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_IMPLICIT, IDENTITY_LATER, IDENTITY_SHEET_LINE, agentIdentity, createIdentity, identityName, type IdentityHost } from "./agent-identity.ts";

test("only a named account gets agent.<it>: an implicit 64-hex one can't have sub-accounts, and it's said", async () => {
  assert.equal(identityName("kim.near"), "agent.kim.near");
  assert.equal(identityName("kim-safe.testnet"), "agent.kim-safe.testnet");
  assert.equal(identityName("a".repeat(64)), null);
  const calls: string[] = [];
  const h = { accountId: "f".repeat(64), chain: { commonBlock: async () => ({}), view: async () => (calls.push("view"), null) }, newKey: async () => { throw new Error("no key"); }, run: async () => (calls.push("run"), { status: "done" }) } as unknown as IdentityHost;
  assert.deepEqual(await agentIdentity(h), { name: null, line: IDENTITY_IMPLICIT, canMake: false });
  await assert.rejects(createIdentity(h), (e: any) => e.problem.more === IDENTITY_IMPLICIT);
  assert.deepEqual(calls, [], "nothing asked, no sheet");
});

test("the sheet's one line says it's a name, not money", () => {
  assert.equal(IDENTITY_SHEET_LINE("agent.kim.near"), "agent.kim.near is AgentZero's name. It holds no money and can't move yours.");
  assert.match(IDENTITY_LATER, /next update\. Nothing changed\./);
});
