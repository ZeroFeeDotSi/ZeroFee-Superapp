// Audit 18's I2 (builder 22, 8 Nov): a Move's job screen had no steps: "Job created. / Moving it to your Safe. / NEAR
// Confidential moves it. NEAR lands it. / About 2 min left.", the same 8 s later, while its Jobs row's steps tick (rule 11;
// S16-8 for two audits). Now the Move's receipt draws the job's own rows' steps, as its rows say them, each ticked only on
// its row's read (the live watch updates the row), from the first frame; one clock (TimeLeft), no time on a step.
// Fails on main: no job-row-steps.ts, no steps on the Move's receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { startJob } from "@zerofee/shell-api/job-start.ts";
import { jobStepsOf } from "./job-row-steps.ts";

test("move-steps-b22: the job's steps, its starting row's, then the core rows it was made with, ticking on their reads", () => {
  const store = createTaskStore();
  const tasks = store.forApp("wallet");
  const job = startJob(tasks, { title: "Move $60.00 to your SOL wallet", usd: "$60.00", etaSec: 40, approve: true }, { store });
  const first = jobStepsOf(store.list(), job.id);
  assert.ok(first.length >= 1, "the first frame has the job's steps");
  assert.equal(first[0]!.state, "doing");
  // the core's row for this Move, as the live watch publishes it (live-steps moveTrack's words)
  tasks.publish({ id: "move:m1", title: "Move $60.00 to your SOL wallet", steps: [
    { label: "NEAR Confidential is moving it to Private.", state: "doing" },
    { label: "Then NEAR Intents moves it to Solana.", state: "waiting" },
    { label: "Then Solana lands it in your SOL wallet.", state: "waiting" },
  ] } as never);
  tasks.publish({ id: "move:other", title: "Someone else's", steps: [{ label: "Not this job's", state: "doing" }] } as never);
  job.made(["move:m1"]);
  const made = jobStepsOf(store.list(), job.id).filter((s) => s.key.startsWith("move:m1"));
  assert.deepEqual(made.map((s) => s.state), ["doing", "waiting", "waiting"]);
  assert.ok(!jobStepsOf(store.list(), job.id).some((s) => s.label === "Not this job's"), "only this job's rows");
  // a chain read ticks the row: the receipt's steps tick with it
  tasks.update("move:m1", { steps: [
    { label: "NEAR Confidential moved it to Private.", state: "done" },
    { label: "NEAR Intents is moving it to Solana.", state: "doing" },
    { label: "Then Solana lands it in your SOL wallet.", state: "waiting" },
  ] } as never);
  const ticked = jobStepsOf(store.list(), job.id).filter((s) => s.key.startsWith("move:m1"));
  assert.deepEqual(ticked.map((s) => `${s.label}:${s.state}`), ["NEAR Confidential moved it to Private.:done", "NEAR Intents is moving it to Solana.:doing", "Then Solana lands it in your SOL wallet.:waiting"]);
  for (const s of ticked) assert.doesNotMatch(s.label, /\d+ s\b|min\b|left/, "no clock on a step: the receipt has one");
  assert.deepEqual(jobStepsOf(store.list(), null), [], "no job: no steps");
});

test("move-steps-b22: the Move's receipt draws them under its line, with its one clock", () => {
  const sheet = readFileSync(new URL("../screens/MoveSheet.tsx", import.meta.url), "utf8");
  const made = sheet.slice(sheet.indexOf('data-testid="move-made"'), sheet.indexOf('data-testid="move-made-done"'));
  assert.ok(made.includes('<JobRowSteps job={madeJob} testid="move-made-steps" />'), "fails on main: no steps on the Move's job screen");
  assert.equal((made.match(/<TimeLeft /g) ?? []).length, 2, "one clock (TimeLeft, by endsAt or etaSec), unchanged");
  const jm = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  assert.match(jm, /useState<RowStep\[\]>\(\(\) => jobStepsOf\(taskStore\(\)\.list\(\), job\)\)/, "the first frame has them");
});
