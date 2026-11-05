// The chat's act card (Slot B's walk): with AGENT_ACT on it goes to the core (the act-scope sheet, then the act); a kind
// the core refuses shows the core's own words; a no on the sheet moves nothing. Before, the card always said "can't do
// this yet" and never asked the core.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { runChatAct } from "./chat-act.ts";

function bridgeOf(answer: (method: string, p: Record<string, unknown>) => BridgeResult<unknown>) {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const bridge: Bridge = { call: async <T>(method: string, p: Record<string, unknown> = {}) => (calls.push({ method, p }), answer(method, p) as BridgeResult<T>), on: () => () => {} };
  return { bridge, calls };
}
const problem = (more: string) => ({ problem: { code: "security.request.not-allowed", whatHappened: "No.", more, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }) as BridgeResult<unknown>;

test("a move goes to the core: the act-scope sheet first, then the act, as the person's own ask", async () => {
  const { bridge, calls } = bridgeOf(() => ({ ok: { scope: {} } }));
  const acts: unknown[] = [];
  const r = await runChatAct(bridge, async (a) => (acts.push(a), { ok: true, line: "Moved $5 from Trading to your SOL row." }), { act: "move", from: "spending", to: "sol", usd: 5 }, "k1");
  assert.deepEqual(calls.map((c) => c.method), ["account.agent.actScope"]);
  assert.deepEqual(calls[0]!.p, { set: { kinds: ["move"], places: ["spending", "sol"], payees: [], dayUsd: 5, minutes: 60 } });
  assert.deepEqual(acts, [{ kind: "move", from: "spending", to: "sol", usd: 5, key: "k1", source: "you" }]);
  assert.deepEqual(r, { ok: true, line: "Moved $5 from Trading to your SOL row." });
});

test("a kind the core refuses shows the core's own words; a no on the sheet moves nothing; the Safe is never a place", async () => {
  const refused = bridgeOf(() => problem("This job doesn't let AgentZero send. Nothing moved."));
  let acted = 0;
  const r = await runChatAct(refused.bridge, async () => (acted++, { ok: true, line: "" }), { act: "send", from: "sol", to: null, usd: 2 }, "k2");
  assert.deepEqual(r, { ok: false, line: "This job doesn't let AgentZero send. Nothing moved." });
  const no = bridgeOf(() => ({ ok: { declined: true } }));
  assert.deepEqual(await runChatAct(no.bridge, async () => (acted++, { ok: true, line: "" }), { act: "move", from: "spending", to: "sol", usd: 2 }, "k3"), { ok: false, line: "You said no. Nothing moved." });
  assert.equal(acted, 0);
  const safe = bridgeOf(() => ({ ok: { scope: {} } }));
  await runChatAct(safe.bridge, async () => ({ ok: false, line: "x" }), { act: "move", from: "safe", to: "sol", usd: 2 }, "k4");
  assert.deepEqual((safe.calls[0]!.p.set as { places: string[] }).places, ["sol"], "the Safe is never asked for as a place");
});
