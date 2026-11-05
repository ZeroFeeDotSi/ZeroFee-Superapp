// the copy review's rule (5 Nov, Sim shot on 8179725b6): a receipt that reads "Landed early." must not still say "You can close this.
// It keeps going." The line shows while the job is going and drops once it landed, on every receipt that draws it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { startJob, JOB_WORDS, watchShown } from "@zerofee/shell-api/job-start.ts";
import { landedOf } from "@zerofee/shell-api/job-steps.ts";

const T = 1_800_000_000_000;
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function job(land: boolean) {
  let now = T;
  const store = createTaskStore({ now: () => now });
  const tasks = store.forApp("wallet");
  const j = startJob(tasks, { title: "Move $5.01 to your Safe", usd: "$5.01", etaSec: 240 }, { now: () => now, store });
  now = T + 1_500;
  tasks.publish({ id: "move:row-1", title: "Move $5.01 to your Safe", steps: [{ label: "Through NEAR", state: "doing" }], startedAt: T + 900 });
  j.made(["move:row-1"]);
  if (land) { now = T + 50_000; tasks.end("move:row-1", "done"); }
  return landedOf(store.list(), T);
}

test("a landed job's receipt drops \"You can close this. It keeps going.\" (control: a job still going keeps it)", () => {
  assert.equal(JOB_WORDS.watch, "You can close this. It keeps going.");
  assert.equal(watchShown(job(true)), false, "landed: the line is false, so it drops");
  assert.equal(watchShown(job(false)), true, "control: still going, the line stays");
});

test("every receipt draws the line through TimeLeft's watch, never on its own (JobMade, a site's Take out, AgentZero's fill)", () => {
  for (const p of ["./JobMade.tsx", "./SiteMoney.tsx", "../../../../../apps/web/src/agentzero/AgentWallet.tsx"]) {
    assert.doesNotMatch(src(p), /<p className="zf-receipt__line">\{JOB_WORDS\.watch\}<\/p>/, p);
  }
  assert.match(src("./JobMade.tsx"), /<TimeLeft etaSec=\{etaSec\} watch \/>/);
});
