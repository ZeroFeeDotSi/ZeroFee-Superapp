// b18 (review MUST 2): a done browse run's Activity row says how long it took, on the run's one clock, as every
// other job row does; the report is cut first, never the time; a stop or a failure says no time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doneDetail, runTask } from "./site-tasks.ts";

test("the done row ends with Took N s., from the run's own Start to its end", () => {
  const done = runTask({ phase: "ended", line: "AgentZero is done on mugs.example.com.", done: true, summary: "Blue mug costs $12.00 on mugs.example.com.", at: 1_000, endedAt: 6_000 }, [], 1_000, "mugs.example.com")!;
  assert.deepEqual(done.end, { state: "done", detail: "AgentZero is done on mugs.example.com. Blue mug costs $12.00 on mugs.example.com. Took 5 s." });
  const long = doneDetail("AgentZero is done on a.example.", "word ".repeat(80).trim(), "Took 5 s.");
  assert.ok(long.length <= 300 && long.endsWith(" Took 5 s.") && !/…|\.\.\./.test(long), "the time is kept, the report is cut at a word");
  const stopped = runTask({ phase: "ended", line: "Stopped. Nothing was sent.", at: 1_000, endedAt: 6_000 }, [], 1_000, "mugs.example.com")!;
  assert.equal(stopped.end?.detail, "Stopped. Nothing was sent.");
});
