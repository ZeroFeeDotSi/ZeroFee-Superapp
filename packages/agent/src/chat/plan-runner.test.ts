// The phone test, 3 Nov: a plan opened Move, the tester approved it, and AgentZero forgot step 2. The runner: the next step
// opens when its money is there (not on a "landed" AgentZero can't read), once, outside the chat screen; late is said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendSheet, type HomeSheet } from "./home-ask.ts";
import { fit, reopened, startPlan, type Balances, type Plan } from "./plan.ts";
import { planRunner, POLL_MS, WAIT_MAX_MS, type RunnerMove } from "./plan-runner.ts";
import { foldRunner, resumeItems, runnerFor, type ChatItem } from "./use-chat-turn.ts";

const SOL = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";
const SEND20 = sendSheet({ to: SOL, usd: 20, coin: "SOL" }, `Send $20 in SOL to ${SOL}`) as HomeSheet;
const started = () => (startPlan((fit(SEND20, { safe: 25, sol: 0, hood: 0, near: 0 }, 1) as { plan: Plan }).plan) as { plan: Plan }).plan;

function rig(o: { visible?: () => boolean } = {}) {
  let t = 0;
  let bal: Balances | null = { safe: 4, sol: 0, hood: 0, near: 0 };
  let reads = 0;
  const timers: (() => void)[] = [];
  const moves: RunnerMove[] = [];
  const r = planRunner({
    balances: async () => (reads++, bal),
    apply: (_id, m) => void moves.push(m),
    now: () => t,
    visible: o.visible ?? (() => true),
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => undefined,
  });
  const tick = async (ms = POLL_MS) => {
    t += ms;
    const due = timers.splice(0);
    for (const f of due) f();
    await new Promise((x) => setTimeout(x, 0));
  };
  return { r, moves, tick, setBal: (b: Balances | null) => void (bal = b), reads: () => reads, flush: () => new Promise((x) => setTimeout(x, 0)) };
}

test("step 1 went (its onward leg unreadable): one line, then step 2 opens by itself the moment the SOL wallet has the money, once (controls: no money, no card; later ends change nothing)", async () => {
  const g = rig();
  const p = started();
  assert.equal(g.r.ended("c1", p, { id: p.id, step: 0 }, { kind: "went" }), null);
  await g.flush();
  assert.equal(g.moves[0]!.line, "Step 1 is on its way. I'll open step 2 as soon as your SOL wallet has the money.");
  assert.equal(g.moves.some((m) => m.sheet), false, "control: no money yet, no card");
  await g.tick();
  assert.equal(g.moves.some((m) => m.sheet), false);
  g.setBal({ safe: 4, sol: 20.4, hood: 0, near: 0 });
  await g.tick();
  const opened = g.moves.filter((m) => m.sheet);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]!.line, "Your SOL wallet has $20.40 now. Step 2 of 2 is below: tap Open, then Face ID.");
  assert.deepEqual(opened[0]!.sheet!.plan, { id: p.id, step: 1 });
  assert.equal(opened[0]!.sheet!.ask.kind, "send");
  // never twice: more ticks, a late "landed" from step 1's card, nothing new
  await g.tick();
  await g.tick();
  assert.equal(g.r.ended("c1", opened[0]!.plan, { id: p.id, step: 0 }, { kind: "landed" }), null);
  assert.equal(g.moves.filter((m) => m.sheet).length, 1);
  assert.equal(g.r.plan("c1"), null, "the runner lets go once the step is open");
});

test("ten minutes with no money: said, with Check again and Stop (never silent); Check again waits again; Stop stops every read", async () => {
  const g = rig();
  const p = started();
  g.r.ended("c2", p, { id: p.id, step: 0 }, { kind: "went" });
  await g.flush();
  await g.tick(WAIT_MAX_MS);
  const late = g.moves.at(-1)!;
  assert.equal(late.late, true);
  assert.equal(late.line, "Step 1 hasn't reached your SOL wallet yet. Nothing else has moved.");
  const readsAtLate = g.reads();
  await g.tick();
  assert.equal(g.reads(), readsAtLate, "late: no more reads until Check again");
  g.r.check("c2", late.plan);
  await g.flush();
  assert.equal(g.moves.at(-1)!.line, "Checking again.");
  g.setBal({ safe: 4, sol: 21, hood: 0, near: 0 });
  await g.tick();
  assert.equal(g.moves.filter((m) => m.sheet).length, 1);
  // Stop: no reads after it
  const h = rig();
  h.r.ended("c3", p, { id: p.id, step: 0 }, { kind: "went" });
  await h.flush();
  h.r.stop("c3");
  const n = h.reads();
  await h.tick();
  await h.tick();
  assert.equal(h.reads(), n);
  assert.equal(h.r.plan("c3"), null);
});

test("no reads while the page is hidden; a closed step is the plan's own pause (control: the runner doesn't wait on it)", async () => {
  let shown = false;
  const g = rig({ visible: () => shown });
  const p = started();
  g.r.ended("c4", p, { id: p.id, step: 0 }, { kind: "went" });
  await g.flush();
  await g.tick();
  assert.equal(g.reads(), 0);
  shown = true;
  await g.tick();
  assert.equal(g.reads(), 1);
  const closed = g.r.ended("c5", p, { id: p.id, step: 0 }, { kind: "closed" });
  assert.equal(closed!.plan.state, "paused");
  assert.equal(g.r.plan("c5"), null);
});

test("it survives the chat leaving the screen and a reload: with no chat on screen the move goes into the saved chat; reopened, the waiting plan is watched again and step 2's card comes back", async () => {
  const saved = new Map<string, { items: ChatItem[]; history: never[]; plan?: Plan | null }>();
  saved.set("c6", { items: [{ kind: "you", text: "send $20 in SOL" }], history: [] });
  const store = { load: async (id: string) => saved.get(id) ?? null, save: async (id: string, c: { items: ChatItem[]; history: never[]; plan?: Plan | null }) => (saved.set(id, c), []) } as never;
  let bal: Balances = { safe: 4, sol: 0, hood: 0, near: 0 };
  const bridge = {} as never;
  const { runner, sinks } = runnerFor(bridge, { balances: async () => bal }, store);
  assert.equal(runnerFor(bridge, { balances: async () => bal }, store).runner, runner, "one runner per bridge, for the app's life");
  const p = started();
  // the chat screen is gone: no sink
  assert.equal(sinks.size, 0);
  runner.ended("c6", p, { id: p.id, step: 0 }, { kind: "went" });
  await new Promise((x) => setTimeout(x, 10));
  assert.match(JSON.stringify(saved.get("c6")!.items), /Step 1 is on its way/);
  assert.equal(saved.get("c6")!.plan!.wait !== undefined, true);
  // a reload: the saved plan, reopened, still waits (never "not known"), and the runner picks it up again
  const back = reopened(saved.get("c6")!.plan!);
  assert.equal(back.steps[back.at]!.status, "waiting");
  assert.equal(back.state, "running");
  // step 2's card, once shown and saved, comes back on screen on reload
  const shownPlan: Plan = { ...back, steps: back.steps.map((s, i) => (i === 1 ? { ...s, status: "shown" as const } : s)) };
  delete shownPlan.wait;
  const items = resumeItems([], shownPlan);
  assert.equal(items.length, 1);
  assert.deepEqual((items[0] as { sheet: { plan: unknown } }).sheet.plan, { id: p.id, step: 1 });
  // control: a plan with nothing shown puts no card back
  assert.deepEqual(resumeItems([], back), []);
  runner.stop("c6");
  void bal;
  bal = { safe: 0, sol: 0, hood: 0, near: 0 };
  // the late card is spent once the plan moves on
  const lateItems = foldRunner([], { plan: { ...back, late: true }, line: "late", late: true });
  assert.equal(lateItems.filter((i) => i.kind === "needs-you").length, 1);
  const after = foldRunner(lateItems, { plan: { ...back } });
  assert.equal((after.find((i) => i.kind === "needs-you") as { stale?: boolean }).stale, true);
});

import { keptItems, OLD_SHEET_LINE } from "./chats.ts";
test("a saved chat keeps a plan step's own line, never \"nothing moved\" for a step that may have gone (control: any other card is still the old-sheet line)", () => {
  const p = started();
  const step: ChatItem = { kind: "needs-you", sheet: { kind: "home", ...p.steps[0]!.sheet!, plan: { id: p.id, step: 0 } } };
  const plain: ChatItem = { kind: "needs-you", sheet: { kind: "home", ...SEND20 } };
  const card: ChatItem = { kind: "needs-you", sheet: { kind: "plan", plan: p } };
  assert.deepEqual(keptItems([card, step, plain]), [{ kind: "say", line: "Plan: 1) Move $21.00 from your Safe to your SOL wallet. 2) Send $20.00 in SOL to Do1R…7vcy." }, { kind: "say", line: "Move $21.00 from your Safe to your SOL wallet." }, { kind: "old-sheet", line: SEND20.line, was: {} }]);
  void OLD_SHEET_LINE;
});
