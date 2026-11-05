// D144: the Browser's tasks for the Activity centre, as pure mappers: a site wallet's Add and Take out with their real
// legs, a site's sign-in, AgentZero's browser run. Never an address or a key; dollars only in the title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { addLanded, addTask, backSteps, backTask, dollarsIn, runTask, signInTask } from "./site-tasks.ts";

test("an Add: the money sheet's own dollars in the title, its legs as steps, done when it lands (control: no figure, no dollars)", () => {
  const t = addTask("pump.fun", "$10.00 is on its way to pump.fun.", 1000);
  assert.equal(t.title, "Add $10.00 to your pump.fun wallet");
  assert.deepEqual(t.steps.map((s) => [s.label, s.state]), [["Left your Safe", "done"], ["Into Spending, privately", "doing"], ["Into your pump.fun wallet", "waiting"]]);
  assert.equal(addTask("pump.fun", undefined, 1).title, "Add money to your pump.fun wallet");
  assert.deepEqual(addLanded("pump.fun", 2).steps.map((s) => s.state), ["done", "done", "done"]);
  assert.equal(dollarsIn("$1,200.50 is on its way"), "$1,200.50");
});

test("a Take out follows the core's own record: pending, its first leg failing, home, or stopped in Spending (each with its line)", () => {
  assert.equal(backTask("GMGN", "$9.70 is on its way to your Safe.", 5).title, "Take out $9.70 from your GMGN wallet");
  assert.deepEqual(backSteps("GMGN", { back: { status: "pending" } }).steps.map((s) => s.state), ["doing", "waiting", "waiting"]);
  assert.equal(backSteps("GMGN", { back: { status: "pending" } }).end, undefined, "still going: no end");
  assert.deepEqual(backSteps("GMGN", { back: { status: "done" }, home: { status: "pending" } }).steps.map((s) => s.state), ["done", "done", "doing"]);
  assert.deepEqual(backSteps("GMGN", { back: { status: "done" }, home: { status: "done" } }).end, { state: "done", detail: "It's in your Safe." });
  assert.equal(backSteps("GMGN", { back: { status: "failed" } }).end?.state, "failed");
  assert.match(backSteps("GMGN", { back: { status: "failed" } }).end!.detail, /still in your GMGN wallet/);
  assert.equal(backSteps("GMGN", { back: { status: "done" }, home: { status: "refunded" } }).end?.detail, "It stopped in Spending. It's safe there.");
});

test("a site's sign-in: signing publishes, signed ends done, a sign-out says it plainly; signing again keeps the same task", () => {
  const s = signInTask("pump.fun", "signing", 7);
  assert.equal(s.publish?.title, "Sign in to pump.fun");
  assert.equal(signInTask("pump.fun", "signing-again", 8, "signin-pump-fun-7").publish?.id, "signin-pump-fun-7");
  assert.deepEqual(signInTask("pump.fun", "signed", 9).end, { state: "done", detail: "Signed in." });
  assert.equal(signInTask("pump.fun", "failed", 9).end?.state, "failed");
});

test("AgentZero's run: one task, its steps as they happen, the person's turn waiting, and how it ended", () => {
  assert.equal(runTask({ phase: "idle" }, [], 1, null), null);
  const start = runTask({ phase: "starting", host: "shop.example.com" }, [], 1, null)!;
  assert.equal(start.task.title, "AgentZero on shop.example.com");
  assert.deepEqual(start.task.steps.map((s) => s.state), ["doing"]);
  const acting = runTask({ phase: "agent", host: "shop.example.com", steps: ["Opening a link", "Scrolling the page"] }, ["Opening a link", "Scrolling the page"], 1, "shop.example.com")!;
  assert.deepEqual(acting.task.steps.map((s) => [s.label, s.state]), [["Opening shop.example.com", "done"], ["Opening a link", "done"], ["Scrolling the page", "doing"]]);
  const yours = runTask({ phase: "you", host: "shop.example.com", why: "sign-in" }, ["Opening a link"], 1, "shop.example.com")!;
  assert.deepEqual(yours.task.steps.at(-1), { label: "Your turn: sign in", state: "waiting" });
  assert.equal(runTask({ phase: "ended", line: "Stopped. Nothing was sent." }, [], 1, "a.example")!.end?.state, "stopped");
  assert.equal(runTask({ phase: "ended", line: "AgentZero is done on a.example." }, [], 1, "a.example")!.end?.state, "done");
  assert.deepEqual(runTask({ phase: "ended", line: "The site didn't answer. Nothing was sent." }, [], 1, "a.example")!.end, { state: "failed", detail: "The site didn't answer. Nothing was sent." });
  // eight at most (the centre keeps twelve)
  const many = Array.from({ length: 20 }, (_, i) => `Step ${i}`);
  assert.ok(runTask({ phase: "agent", host: "a.example", steps: many.slice(-5) }, many, 1, "a.example")!.task.steps.length <= 8);
});

test("the Browser's tasks go into the shell's store as the Browser's (and the store refuses an app it doesn't own: control)", () => {
  const store = createTaskStore();
  const browser = store.forApp("browser");
  assert.equal(browser.publish(addTask("pump.fun", "$5.00 is on its way to pump.fun.", 1)), true);
  assert.equal(store.list()[0]?.app, "browser");
  assert.equal(store.forApp("wallet").publish({ ...addTask("pump.fun", undefined, 2), app: "browser" }), false);
  // nothing in a task names an address or a key
  assert.doesNotMatch(JSON.stringify(store.list()), /0x[0-9a-f]{20,}|[1-9A-HJ-NP-Za-km-z]{32,44}/);
});

test("phone test, 3 Nov: a background warm-up's sign-in never shows as a task; one the person opened does; every sign-in task has a 2-minute hard end with a plain line", async () => {
  const { showsSignIn, SIGN_IN_TASK_MS, signInStuck } = await import("./site-tasks.ts");
  assert.equal(showsSignIn("signing", false, false), false, "a warm window signing in off screen: no task");
  assert.equal(showsSignIn("signed", false, false), false, "nor its end");
  assert.equal(showsSignIn("signing", true, false), true, "control: the person's own window: a task");
  assert.equal(showsSignIn("signed", false, true), true, "a task already open still hears its end after the window goes");
  assert.equal(showsSignIn("signing", false, true), false, "but never a new one off screen");
  assert.ok(SIGN_IN_TASK_MS <= 2 * 60_000);
  assert.equal(signInStuck("pump.fun"), "pump.fun didn't finish signing in. Nothing moved. Open pump.fun to try again.");
});
