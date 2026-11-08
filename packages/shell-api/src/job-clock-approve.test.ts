// Audit 10's A8 (8 Nov): a Safe Move's Jobs row said "Slower than usual" (then "5 s left") on its first frame after
// Approve, its time left rose to 56 s, and it said "Done in 30 s" (the Sim re-walk: "Done in 1 min") about 6-8 s after
// Approve: its clock ran from the tap, before the Check sheet filled and the person read it. Now the clock starts at the
// Approve: the first frame says the whole job's time, the time left only falls, and "Done in" counts from the Approve.
// Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "./tasks.ts";
import { startJob } from "./job-start.ts";
import { timeLeft } from "./job-steps.ts";

test("A8: a Safe job's clock starts at the Approve: the whole job's time on the first frame, never risen, Done timed from the Approve (control: a job with no Approve keeps its tap's clock)", () => {
  let t = 1_000_000;
  const now = () => t;
  const store = createTaskStore({ now });
  const tasks = store.forApp("wallet");
  const job = startJob(tasks, { title: "Move $55.00 to your SOL wallet", usd: "$55.00", etaSec: 60, approve: true }, { now, store });
  const row = () => store.list().find((x) => x.id === job.id)!;
  // the Check sheet fills and the person reads it: 130 s go by before Approve (past twice the 60 s)
  t += 130_000;
  assert.equal(timeLeft(row().endsAt, t, row().startedAt), "Slower than usual.", "control: before Approve, the tap's clock (the bug's first frame)");
  job.approved();
  assert.equal(row().startedAt, t, "the clock starts at the Approve");
  assert.equal(timeLeft(row().endsAt, t, row().startedAt), "1 min left", "the whole job's time on the first frame");
  const lefts: number[] = [];
  for (let i = 0; i < 6; i++) { t += 1_000; lefts.push(row().endsAt! - t); }
  assert.deepEqual(lefts, [...lefts].sort((a, b) => b - a), "the time left only falls");
  assert.ok(t - row().startedAt < 10_000, "Done in counts from the Approve: 6 s, never the 136 s since the tap");

  let u = 5_000_000;
  const store2 = createTaskStore({ now: () => u });
  const plain = startJob(store2.forApp("wallet"), { title: "Send $5.00", etaSec: 10 }, { now: () => u, store: store2 });
  const started = store2.list().find((x) => x.id === plain.id)!.startedAt;
  u += 3_000;
  plain.approved();
  assert.equal(store2.list().find((x) => x.id === plain.id)!.startedAt, started, "control: no Approve step, the tap's clock stays");
});
