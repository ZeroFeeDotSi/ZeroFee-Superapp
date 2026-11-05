// Phone test (3 Nov): "Sign in to pump.fun" and "Sign in to GMGN" sat on "Signing in…" for 2.5 h. A task that
// says how long it may sit (staleMs) ends failed after it; the Browser's old sign-ins (id "signin-…") get 2 minutes, so
// the ones stranded on a phone clear on its next open; a money task never ends by this rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore, TASKS_KEY } from "./tasks.ts";

const kvOf = (init?: unknown) => {
  const m = new Map<string, string>(init ? [[TASKS_KEY, JSON.stringify(init)]] : []);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("a task with staleMs ends failed once it hasn't moved for that long; an update keeps it alive", () => {
  let t = 1_000_000;
  const store = createTaskStore({ kv: kvOf(), now: () => t });
  const tasks = store.forApp("trade");
  tasks.publish({ id: "a", title: "Buy $1 of BONK", steps: [{ label: "Sent", state: "doing" }], staleMs: 120_000, staleDetail: "Didn't finish. Nothing moved." });
  t += 100_000;
  tasks.update("a", { steps: [{ label: "Sent", state: "done" }, { label: "Landed", state: "doing" }] });
  t += 100_000;
  assert.equal(store.list()[0]!.state, "pending", "an update 100 s ago keeps it going");
  t += 30_000;
  const ended = store.list()[0]!;
  assert.equal(ended.state, "failed");
  assert.equal(ended.detail, "Didn't finish. Nothing moved.");
  assert.ok(ended.steps.every((s) => s.state !== "doing"), "no step left spinning");
  assert.equal(store.pending(), 0);
});

test("the Browser's stranded sign-ins clear on load; a Move (money) left pending is never ended by this rule", () => {
  const now = 10_000_000;
  const old = now - 2.5 * 3_600_000;
  const kv = kvOf([
    { id: "signin-pump-fun-1", app: "browser", title: "Sign in to pump.fun", steps: [{ label: "Opening pump.fun", state: "done" }, { label: "Signing in…", state: "doing" }], state: "pending", startedAt: old },
    { id: "move-1", app: "home", title: "Move $3.00 to your SOL wallet", steps: [{ label: "Arriving…", state: "doing" }], state: "pending", startedAt: old },
  ]);
  const store = createTaskStore({ kv, now: () => now });
  const list = store.list();
  const signin = list.find((x) => x.id === "signin-pump-fun-1")!;
  assert.equal(signin.state, "failed");
  assert.equal(signin.detail, "Didn't finish signing in. Nothing moved.");
  // control: the money task stays as it was (its own reads end it; the store can't say where money is)
  assert.equal(list.find((x) => x.id === "move-1")!.state, "pending");
  // the end is kept on the phone
  const kept = JSON.parse(kv.m.get(TASKS_KEY)!) as { id: string; state: string }[];
  assert.equal(kept.find((x) => x.id === "signin-pump-fun-1")?.state, "failed");
});

// Phone test, 4 Nov: an Add's task left "Making it private…" spinning. However a task ends (done, failed,
// stopped), no step under it still says it is going.
test("bug (Activity stuck): ending a task leaves no step 'doing' (control: done and failed steps stay as they were)", () => {
  const store = createTaskStore({ kv: kvOf(), now: () => 5_000_000 });
  const home = store.forApp("wallet");
  home.publish({ id: "add:x", title: "Adding SOL to your Safe", steps: [{ label: "Received", state: "done" }, { label: "Making it private", state: "doing" }, { label: "In your Safe", state: "waiting" }] });
  assert.equal(home.end("add:x", "stopped", "No more news on this. Home shows where your money is."), true);
  const t = store.list()[0]!;
  assert.equal(t.state, "stopped");
  assert.deepEqual(t.steps.map((s) => s.state), ["done", "waiting", "waiting"]);
  home.publish({ id: "b", title: "Move $3.00", steps: [{ label: "Left", state: "done" }, { label: "Through NEAR", state: "failed" }] });
  home.end("b", "failed");
  assert.deepEqual(store.list().find((x) => x.id === "b")!.steps.map((s) => s.state), ["done", "failed"], "control");
});
