// QA (5 Nov): during a dispute (a second device's no, release 10 round 2's `dispute_until`) the contract's
// `agent()` still says paused: false while agent_pay is refused, so the core's account.agent.view reads dispute_until
// too and hands its end to the AgentZero screen. Controls: no dispute, and an older contract without the view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCall, type AgentCtx } from "./agent-door.ts";

const ctx = (dispute: () => Promise<unknown>): AgentCtx =>
  ({
    chain: {
      commonBlock: async () => ({ height: 1, hash: "h" }),
      view: async (_a: string, method: string) => (method === "agent" ? { budget: { coins: [], recipients: [] }, paused: false } : method === "dispute_until" ? dispute() : null),
      accessKeys: async () => [],
    },
    vault: { get: async () => null },
    modulesSigner: async () => ({ accountId: "zf-aaaaaaaaaa.near" }),
  }) as unknown as AgentCtx;

test("account.agent.view carries the dispute's end while one is open (agent() alone says paused: false)", async () => {
  const v = (await agentCall(ctx(async () => "1999999999000000000"), "account.agent.view", {})) as { paused: boolean; disputeUntilNs?: string };
  assert.equal(v.paused, false);
  assert.equal(v.disputeUntilNs, "1999999999000000000");
});

test("control: no dispute (null), or an older contract without dispute_until (a throw): no field, the view as before", async () => {
  for (const d of [async () => null, async () => Promise.reject(new Error("MethodNotFound"))]) {
    const v = (await agentCall(ctx(d), "account.agent.view", {})) as Record<string, unknown>;
    assert.equal("disputeUntilNs" in v, false);
    assert.equal(v.paused, false);
  }
});
