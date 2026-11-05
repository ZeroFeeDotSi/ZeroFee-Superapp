// Heat (perf engineer, 3 Nov: "the phone is heating up to the max"): the Spending engine's 1 s follow ran with nothing
// under way, and its 120 s round read the wallets while the page rested. Now the round is an idle read on the shell's one
// scheduler (nothing while resting, one read on return), and the follow wakes every second only while a money step is
// under way, else every FOLLOW_IDLE_MS; any change brings it straight back. It never pauses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { FOLLOW_IDLE_MS, FOLLOW_MS, ROUND_MS, bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));

/** Timers as the engine asks for them: each with its period, and whether it is still on. */
function timers() {
  const all: { fn: () => void; ms: number; on: boolean; idle: boolean }[] = [];
  const make = (idle: boolean) => (fn: () => void, ms: number) => { const t = { fn, ms, on: true, idle }; all.push(t); return () => { t.on = false; }; };
  return { every: make(false), idleEvery: make(true), live: () => all.filter((t) => t.on), all };
}

async function setup(withIdle = true) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood"]) await call("subwallet.create", { kind: "trade", chain });
  const t = timers();
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const store = new Map<string, unknown>();
  const f = createCoreFloat({
    offered: () => true, call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); }, now: () => Date.now(), rng: () => 0.5,
    every: t.every, ...(withIdle ? { idleEvery: t.idleEvery } : {}),
  });
  return { f, t };
}

test("the round is an idle read (the shell's scheduler); the follow slows to FOLLOW_IDLE_MS with nothing under way and is back to every second the moment a Top up is asked (control: no idle scheduler, the round keeps the plain timer)", async () => {
  const { f, t } = await setup();
  const stop = f.start();
  await settle();
  const round = t.live().find((x) => x.ms === ROUND_MS)!;
  assert.equal(round.idle, true, "the round is on the idle scheduler");
  let follow = t.live().find((x) => !x.idle)!;
  assert.equal(follow.ms, FOLLOW_MS, "the follow starts at its fast pace");
  follow.fn();                                                    // nothing under way
  follow = t.live().find((x) => !x.idle)!;
  assert.equal(follow.ms, FOLLOW_IDLE_MS, "idle: it slows to the safety net");
  assert.equal(t.live().filter((x) => !x.idle).length, 1, "one follow timer, never two");
  assert.notEqual(await f.add(100), "declined");                  // a Top up: the engine is told
  follow = t.live().find((x) => !x.idle)!;
  assert.equal(follow.ms, FOLLOW_MS, "a step under way: every second again, at once");
  stop();
  assert.equal(t.live().length, 0, "stopped: no timer left");
  // control: with no idle scheduler, the round keeps the plain timer
  const c = await setup(false);
  const s2 = c.f.start();
  await settle();
  assert.equal(c.t.live().find((x) => x.ms === ROUND_MS)?.idle, false);
  s2();
});
