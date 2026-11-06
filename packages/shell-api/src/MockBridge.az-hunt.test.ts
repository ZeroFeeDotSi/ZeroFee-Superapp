// The AgentZero bug hunt (5 Nov, realmoney-all/20261104T2103Z-hunt-agentzero): the Sim's AgentZero as the contract and
// the core. A keep top-up is refused by the core's line before any pocket money counts (040/041); funding takes the
// Safe's money and a payment spends it (6 Nov); Stop drops a held raise and a turn-on above the last limit waits like one (042); a new person waits
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

const held = async (m: ReturnType<typeof createMockBridge>) => Number(ok(await m.call<{ usdcMicros: string } | null>("account.agent.balance"))?.usdcMicros ?? 0) / 1e6;
const round = (n: number) => Math.round(n * 100) / 100;

test("funding AgentZero's wallet really takes the Safe's USDC, and Safe + wallet stay the same money (6 Nov: \"Add $25, From your Safe\" moved nothing; control: off, no wallet to count)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  const before = await safeUsdc(m);
  assert.equal(ok(await m.call<{ usdcMicros: string } | null>("account.agent.balance")), null, "control: off, Home has no AgentZero row");
  ok(await m.call("account.agent.set", { limitUsd: 25, people: [] }));
  assert.equal(round(before - (await safeUsdc(m))), 25, "$25 left the Safe");
  assert.equal(await held(m), 25, "and is in its wallet, for Home's row and total");
  assert.equal(ok(await m.call<{ heldUsd: number }>("account.agent.view")).heldUsd, 25);
});

test("a pay list's payment leaves AgentZero's wallet and the Safe stays (it was funded from there), and Home's total falls by it; control: off the list, nothing moves", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.agent.set", { limitUsd: 20, people: ["maya.near"] }));
  const safe = await safeUsdc(m);
  ok(await m.call("account.agent.spend", { kind: "pay", usd: 4, to: "maya.near" }));
  assert.equal(await held(m), 16, "$4 left its wallet");
  assert.equal(await safeUsdc(m), safe, "not paid twice from the Safe");
  const off = await m.call("account.agent.spend", { kind: "pay", usd: 4, to: "kim.near" });
  assert.ok("problem" in off && off.problem.code === "agent.recipient");
  assert.equal(await held(m), 16, "control: off the list, nothing more left");
  const big = await m.call("account.agent.spend", { kind: "pay", usd: 17, to: "maya.near" });
  assert.ok("problem" in big && big.problem.code === "agent.limit.day", "more than its wallet holds is refused");
  assert.equal(await held(m), 16);
});

test("Stop gives back what's left, and a lower limit gives back the difference; the money adds up (controls)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  const before = await safeUsdc(m);
  ok(await m.call("account.agent.set", { limitUsd: 25, people: [] }));
  ok(await m.call("account.agent.setBudget", { limitUsd: 10, people: [] }));
  assert.equal(round(before - (await safeUsdc(m))), 10, "the lower limit gave $15 back");
  assert.equal(await held(m), 10);
  ok(await m.call("account.agent.revoke"));
  assert.equal(round(await safeUsdc(m)), round(before), "all of it back in the Safe");
  assert.equal(ok(await m.call<{ usdcMicros: string } | null>("account.agent.balance")), null, "no AgentZero row once it's off");
});

test("a held raise takes no money until it runs, and none if it's cancelled or Stop drops it; its run takes only the difference (controls)", async () => {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 } });
  const before = await safeUsdc(m);
  ok(await m.call("account.agent.set", { limitUsd: 10, people: [] }));
  const raise = ok(await m.call<{ status: string; id: string }>("account.agent.setBudget", { limitUsd: 50, people: [] }));
  assert.equal(raise.status, "waiting");
  assert.equal(await held(m), 10, "nothing more until its wait ends");
  ok(await m.call("account.waiting.run", { id: raise.id }));
  assert.equal(await held(m), 50);
  assert.equal(round(before - (await safeUsdc(m))), 50);
  const low = createMockBridge({ latencyMs: 0 });
  ok(await low.call("account.agent.set", { limitUsd: 10, people: [] }));
  ok(await low.call("account.agent.setBudget", { limitUsd: 50, people: [] }));
  ok(await low.call("account.agent.revoke"));
  assert.equal(ok(await low.call<{ usdcMicros: string } | null>("account.agent.balance")), null);
});

test("an empty Safe can't fund it: the refusal says what the Safe has, and nothing changes (empty wallet; control: a Safe with enough)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  const have = await safeUsdc(m);
  ok(await m.call("ledger.transfer", { tokenId: USDC, amount: (have - 5).toFixed(2), toAccountId: "kim.near" }));
  const left = await safeUsdc(m);
  assert.ok(left < 25, String(left));
  const no = await m.call("account.agent.set", { limitUsd: 25, people: [] });
  assert.ok("problem" in no && no.problem.code === "agent.funds" && /Your Safe has only .* in USDC\. Nothing moved\./.test(no.problem.whatHappened), JSON.stringify(no));
  assert.equal(await safeUsdc(m), left);
  assert.equal((await view(m)).limitUsd, 0, "still off");
  const big = createMockBridge({ latencyMs: 0 });
  assert.equal(ok(await big.call<{ status: string }>("account.agent.set", { limitUsd: 25, people: [] })).status, "done", "control");
});

test("a reload keeps the wallet's money; a sample kept before it held any takes what it may spend from the Safe once (control: not twice)", async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const a = createMockBridge({ latencyMs: 0, persist: { storage } });
  const before = await safeUsdc(a);
  ok(await a.call("account.agent.set", { limitUsd: 25, people: [] }));
  a.flush();
  const b = createMockBridge({ latencyMs: 0, persist: { storage } });
  assert.equal(await held(b), 25);
  assert.equal(round(before - (await safeUsdc(b))), 25, "control: not taken twice");
  // the old shape: no heldUsd in what was kept, its Safe never charged
  const [key, raw] = [...data.entries()].find(([, v]) => v.includes("heldUsd"))!;
  const old = JSON.parse(raw) as { agent: { heldUsd?: number } };
  delete old.agent.heldUsd;
  data.set(key, JSON.stringify(old));
  const c = createMockBridge({ latencyMs: 0, persist: { storage } });
  assert.equal(await held(c), 25);
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

test("what waits is the account's own answer: a raise, a turn-on, gone with a cancel, a Stop or its run, and kept over a reload (6 Nov; hunt 042; control: none waiting says nothing)", async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const m = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 }, persist: { storage } });
  type W = { waiting?: { usd: number; atIso: string } };
  const w = async (b: ReturnType<typeof createMockBridge>) => ok(await b.call<W>("account.agent.view")).waiting;
  ok(await m.call("account.agent.set", { limitUsd: 10, people: [] }));
  assert.equal(await w(m), undefined, "control");
  const raise = ok(await m.call<{ id: string; readyAtIso: string }>("account.agent.setBudget", { limitUsd: 50, people: [] }));
  assert.deepEqual(await w(m), { usd: 50, atIso: raise.readyAtIso });
  m.flush();
  assert.equal((await w(createMockBridge({ latencyMs: 0, persist: { storage } })))?.usd, 50, "a reload keeps it");
  ok(await m.call("account.agent.cancelWaiting"));
  assert.equal(await w(m), undefined, "a cancel takes it away");
  const again = ok(await m.call<{ id: string }>("account.agent.setBudget", { limitUsd: 25, people: [] }));
  ok(await m.call("account.waiting.run", { id: again.id }));
  assert.equal(await w(m), undefined, "it ran");
  assert.equal((await view(m)).limitUsd, 25);
  ok(await m.call("account.agent.setBudget", { limitUsd: 50, people: [] }));
  ok(await m.call("account.agent.revoke"));
  assert.equal(await w(m), undefined, "Stop drops it");
  const on = ok(await m.call<{ status: string; readyAtIso: string }>("account.agent.set", { limitUsd: 50, people: [] }));
  assert.equal(on.status, "waiting");
  assert.deepEqual(await w(m), { usd: 50, atIso: on.readyAtIso }, "off: the turn-on waits, said by the account");
  assert.equal(ok(await m.call<{ usdcMicros: string } | null>("account.agent.balance")), null, "and it holds nothing yet");
});

test("every move of its wallet tells Home to read its wallets again: fund, buy, Stop (6 Nov walk: Hot's total stayed $5 short; control: a read alone tells nothing)", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  let told = 0;
  m.on("spending.changed", () => told++);
  await m.call("account.agent.view");
  assert.equal(told, 0, "control");
  ok(await m.call("account.agent.set", { limitUsd: 25, people: [] }));
  assert.ok(told > 0, "fund");
  told = 0;
  ok(await m.call("account.agent.spend", { kind: "buy", usd: 5, coin: "BONK", title: "AgentZero bought $5.00 of BONK" }));
  assert.ok(told > 0, "buy");
  told = 0;
  ok(await m.call("account.agent.revoke"));
  assert.ok(told > 0, "Stop");
});
