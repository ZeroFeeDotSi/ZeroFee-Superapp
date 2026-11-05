// The shell's AgentZero pay channel (AZ2 job 3): Chat asks, the payer answers; a payer that fails to load says so and
// never pays, and is loaded again on the next ask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentZeroPayer, lazyAgentZeroPayer, setAgentZeroPayer, type AgentZeroPayer } from "./agentzero-pay.ts";

const fake = (calls: string[]): AgentZeroPayer => ({
  offer: async (a) => (calls.push(`offer ${a.to}`), { ok: true, line: `Pay $${a.usd} · AgentZero` }),
  payRequest: async (a, tap) => (calls.push(`pay ${a.requestId} ${String(tap)}`), { kind: "paid", line: "paid" }),
});

test("no payer set: Chat gets null and keeps its plain Send", () => {
  setAgentZeroPayer(null);
  assert.equal(agentZeroPayer(), null);
});

test("a lazy payer loads once, on first use, and answers through the loaded one", async () => {
  const calls: string[] = [];
  let loads = 0;
  const p = lazyAgentZeroPayer(async () => (loads++, fake(calls)));
  assert.equal(loads, 0, "nothing loads before Chat asks");
  setAgentZeroPayer(p);
  assert.deepEqual(await agentZeroPayer()!.offer({ to: "kim.near", usd: 5 }), { ok: true, line: "Pay $5 · AgentZero" });
  assert.deepEqual(await agentZeroPayer()!.payRequest({ requestId: "m1", to: "kim.near", usd: 5 }, "tap"), { kind: "paid", line: "paid" });
  assert.equal(loads, 1);
  assert.deepEqual(calls, ["offer kim.near", "pay m1 tap"], "the tap is passed through to AgentZero as it came");
  setAgentZeroPayer(null);
});

test("a load that fails: the chip says AgentZero didn't load, nothing is paid, and the next ask loads again", async () => {
  let loads = 0;
  const calls: string[] = [];
  const p = lazyAgentZeroPayer(async () => {
    if (++loads === 1) throw new Error("chunk failed");
    return fake(calls);
  });
  assert.deepEqual(await p.offer({ to: "kim.near", usd: 5 }), { ok: false, line: "AgentZero didn't load. Try again." });
  assert.equal(calls.length, 0);
  assert.deepEqual(await p.payRequest({ requestId: "m1", to: "kim.near", usd: 5 }, "tap"), { kind: "paid", line: "paid" }, "loaded again on the next ask");
  assert.equal(loads, 2);
});
