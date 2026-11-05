// D144: perps' tasks for the Activity centre (app "perps"): each job's steps, ended by the source's own outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { DONE_LINE, perpsSteps, perpsTask } from "./perps-tasks.ts";

test("perps jobs: dollars in the title, the first step doing; ok makes every step done, a refusal fails the first (control)", () => {
  const t = perpsTask("in", 1, 20);
  assert.deepEqual([t.app, t.title], ["perps", "Put $20.00 in perps"]);
  assert.deepEqual(t.steps.map((s) => s.state), ["doing", "waiting"]);
  assert.equal(perpsTask("out", 1).title, "Take money out of perps");
  assert.deepEqual(perpsSteps("in", true, 5).map((s) => s.state), ["done", "done"]);
  assert.deepEqual(perpsSteps("in", false, 5).map((s) => s.state), ["failed", "waiting"]);
  assert.equal(DONE_LINE.on, "Perps are on.");
  // Trade may write perps' tasks; Home may not (control)
  const store = createTaskStore();
  assert.equal(store.forApp("trade").publish(perpsTask("on", 2)), true);
  assert.equal(store.forApp("wallet").publish(perpsTask("off", 3)), false);
});
