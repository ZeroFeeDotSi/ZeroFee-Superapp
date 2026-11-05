// D143 for AgentZero (agent-faceid.ts): every ask AgentZero makes, and whether it keeps Face ID. Face ID only when money
// leaves the Safe or the Safe's account signs, and on the security settings the product named. Control: flip any one
// answer and these go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_ASKS, OWNER_LINE, agentFaceId, type AgentAsk } from "./agent-faceid.ts";

test("every ask is listed, with where it is and why", () => {
  assert.deepEqual(Object.keys(AGENT_ASKS).sort(), ["act-scope", "ask-above-raise", "old-pocket-move", "pair-computer", "pay-cap-raise", "pocket-day", "reply-pay", "safe-account-call", "wallet-empty", "wallet-fill", "wallet-setup-revoke"]);
  for (const [k, r] of Object.entries(AGENT_ASKS)) assert.ok(r.where.length > 5 && r.why.length > 20, k);
  assert.ok(Object.isFrozen(AGENT_ASKS));
});

test("D143: money leaving the Safe (or the Safe's account signing) always keeps Face ID; a money move that doesn't drops it", () => {
  for (const [k, r] of Object.entries(AGENT_ASKS) as [AgentAsk, (typeof AGENT_ASKS)[AgentAsk]][]) {
    if (r.leavesSafe) assert.equal(r.faceId, true, `${k}: money leaves the Safe`);
    if (!r.leavesSafe && !r.setting) assert.equal(r.faceId, false, `${k}: no money leaves the Safe`);
    assert.equal(agentFaceId(k), r.faceId);
  }
});

test("the product list, exactly: Face ID kept on the pocket day, the Safe's own calls, the cap raise and the setup revoke; dropped on fill, empty and credit", () => {
  for (const k of ["pocket-day", "safe-account-call", "pay-cap-raise", "wallet-setup-revoke"] as const) assert.equal(agentFaceId(k), true, k);
  for (const k of ["wallet-fill", "wallet-empty", "reply-pay"] as const) assert.equal(agentFaceId(k), false, k);
  // security settings keep it: they change what may spend, not where money is
  for (const k of ["act-scope", "ask-above-raise", "pair-computer"] as const) assert.equal(agentFaceId(k), true, k);
  assert.match(OWNER_LINE, /cap and revoking AgentZero's old key keep Face ID/);
});
