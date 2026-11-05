// The AgentZero bug hunt (5 Nov, realmoney-all/20261104T2103Z-hunt-agentzero): the Sim's AgentZero as the contract and
// the core. A keep top-up is refused by the core's line before any pocket money counts (040/041); a pay list's payment
// leaves the Safe; Stop drops a held raise and a turn-on above the last limit waits like one (042); a new person waits
// too (023/028); cancelWaiting is there (034); a list holds each name once (025). Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_TOP_UP_OFF } from "@zerofee/core/agent-route";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
type View = { limitUsd: number; spentTodayUsd: string; people: string[]; lastLimitUsd?: number };
const ok = <T,>(r: { ok: T } | { problem: unknown }): T => {
  assert.ok("ok" in r, JSON.stringify(r));
  return r.ok;
};
const view = async (m: ReturnType<typeof createMockBridge>) => ok(await m.call<View>("account.agent.view"));
const safeUsdc = async (m: ReturnType<typeof createMockBridge>) => ok(await m.call<{ tokenId: string; amount: string }[]>("ledger.balances")).filter((b) => b.tokenId === USDC).reduce((t, b) => t + Number(b.amount), 0);

test("a keep top-up is refused with the core's line, and no pocket money is counted (control: a pay to a listed person counts)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.agent.set", { limitUsd: 20, people: ["maya.near"] }));
  const r = await m.call("account.agent.spend", { kind: "top-up", usd: 10, title: "AgentZero moved $10.00 to your SOL wallet" });
  assert.ok("problem" in r && r.problem.code === "security.request.not-allowed", JSON.stringify(r));
  assert.equal("problem" in r ? (r.problem as { more?: string }).more ?? r.problem.whatHappened : "", AGENT_TOP_UP_OFF);
  assert.equal((await view(m)).spentTodayUsd, "0.00", "nothing of the day used");
  const act = ok(await m.call<{ title: string }[]>("account.activity", { limit: 50 }));
  assert.ok(!act.some((a) => /moved \$10/.test(a.title)), "no receipt for a move that never happened");
  ok(await m.call("account.agent.spend", { kind: "pay", usd: 4, to: "maya.near" }));
  assert.equal((await view(m)).spentTodayUsd, "4.00", "control: a payment counts");
});

test("a pay list's payment leaves the Safe's USDC (control: a refused one moves nothing)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.agent.set", { limitUsd: 20, people: ["maya.near"] }));
  const before = await safeUsdc(m);
  ok(await m.call("account.agent.spend", { kind: "pay", usd: 4, to: "maya.near" }));
  assert.equal(Math.round((before - (await safeUsdc(m))) * 100) / 100, 4, "$4 left the Safe");
  const off = await m.call("account.agent.spend", { kind: "pay", usd: 4, to: "kim.near" });
  assert.ok("problem" in off && off.problem.code === "agent.recipient");
  assert.equal(Math.round((before - (await safeUsdc(m))) * 100) / 100, 4, "control: off the list, nothing more left");
});

test("Stop drops a held raise; a turn-on above the last limit waits like one; the first turn-on and one at the old limit are at once (controls)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  assert.equal(ok(await m.call<{ status: string }>("account.agent.set", { limitUsd: 20, people: [] })).status, "done", "control: the first turn-on is at once");
  const raise = ok(await m.call<{ status: string; id: string }>("account.agent.setBudget", { limitUsd: 50, people: [] }));
  assert.equal(raise.status, "waiting");
  ok(await m.call("account.agent.revoke"));
  const waiting = ok(await m.call<{ id: string }[]>("account.waiting"));
  assert.ok(!waiting.some((w) => w.id === raise.id), "the held raise went with the Stop (agent_revoke)");
  assert.equal((await view(m)).lastLimitUsd, 20, "the limit in force is remembered");
  const back = ok(await m.call<{ status: string; readyAtIso?: string }>("account.agent.set", { limitUsd: 50, people: [] }));
  assert.equal(back.status, "waiting", "Turn on at $50 after a Stop waits (hunt 042: on at once)");
  assert.ok(Date.parse(back.readyAtIso!) - Date.now() >= 2 * 86_400_000);
  assert.equal((await view(m)).limitUsd, 0, "still off until then");
  ok(await m.call("account.agent.revoke"));
  assert.equal(ok(await m.call<{ status: string }>("account.agent.set", { limitUsd: 20, people: [] })).status, "done", "control: the old limit again, at once");
  assert.equal((await view(m)).limitUsd, 20);
});

test("a held turn-on runs after its wait and AgentZero is on (control: before it, off)", async () => {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 } });
  ok(await m.call("account.agent.set", { limitUsd: 5, people: [] }));
  ok(await m.call("account.agent.revoke"));
  const held = ok(await m.call<{ status: string; id: string }>("account.agent.set", { limitUsd: 50, people: [] }));
  assert.equal(held.status, "waiting");
  assert.equal((await view(m)).limitUsd, 0, "control: off before it runs");
  ok(await m.call("account.waiting.run", { id: held.id }));
  assert.equal((await view(m)).limitUsd, 50);
});

test("a new person on the list waits the safety wait; taking one off is at once (control); each name once", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.agent.set", { limitUsd: 20, people: ["maya.near", "MAYA.near"] }));
  assert.deepEqual((await view(m)).people, ["maya.near"], "one name once (hunt 025)");
  const add = ok(await m.call<{ status: string }>("account.agent.setBudget", { limitUsd: 20, people: ["maya.near", "kim.near"] }));
  assert.equal(add.status, "waiting", "a new person waits, as the pay list's sheet says");
  assert.deepEqual((await view(m)).people, ["maya.near"]);
  assert.equal(ok(await m.call<{ status: string }>("account.agent.setBudget", { limitUsd: 20, people: [] })).status, "done", "control: off the list at once");
  assert.deepEqual((await view(m)).people, []);
});

test("cancelWaiting: none waiting is 0 of 0 (hunt 034: the missing call read as one); a held raise is cancelled (control)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.agent.set", { limitUsd: 20, people: [] }));
  assert.deepEqual(ok(await m.call<{ cancelled: number; outcomes: unknown[] }>("account.agent.cancelWaiting")), { cancelled: 0, outcomes: [] });
  const raise = ok(await m.call<{ status: string; id: string }>("account.agent.setBudget", { limitUsd: 50, people: [] }));
  const c = ok(await m.call<{ cancelled: number; outcomes: unknown[] }>("account.agent.cancelWaiting"));
  assert.equal(c.cancelled, 1);
  assert.ok(!ok(await m.call<{ id: string }[]>("account.waiting")).some((w) => w.id === raise.id));
  assert.equal((await view(m)).limitUsd, 20, "the limit in force stays");
});
