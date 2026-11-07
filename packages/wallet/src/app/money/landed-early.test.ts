// the copy review's one rule for every job's receipt (5 Nov, real app and Sim alike; words 7 Nov): a job that landed says how long it
// took ("Done in under a second.", "Done in 50 seconds."), never "Landed early.". Never a frozen "About 4 min left", never
// "Slower than usual." over money already there. The receipt's
// TimeLeft follows its job in the shared task store (the rows made since it opened) on an injected clock here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { startJob } from "@zerofee/shell-api/job-start.ts";
import { TIME_WORDS, landedOf, receiptLeft } from "@zerofee/shell-api/job-steps.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const T = 1_800_000_000_000;

/** A Move's receipt opened at T with a 4-minute estimate; its job made at the tap (a "job:" starting row), handed to the
 *  core's row, which the live watch ends done at `landAt` (publishTracks). The clock is the test's. */
function job(landAt: number | null) {
  let now = T;
  const store = createTaskStore({ now: () => now });
  const tasks = store.forApp("wallet");
  const j = startJob(tasks, { title: "Move $5.01 to your Safe", usd: "$5.01", etaSec: 240 }, { now: () => now, store });
  const endsAt = T + 240_000;
  now = T + 1_500;
  tasks.publish({ id: "move:row-1", title: "Move $5.01 to your Safe", steps: [{ label: "Through NEAR", state: "doing" }], startedAt: T + 900 });
  j.made(["move:row-1"]);
  if (landAt !== null) { now = landAt; tasks.end("move:row-1", "done"); }
  return { list: () => store.list(), endsAt };
}

test("landed before its estimate, the receipt says how long it took and stays so as time goes on (never \"About 4 min left\" or \"Slower than usual.\"); landed after it, how long too (copy review, 7 Nov: was \"Almost there.\" frozen); control: still moving, the time left", () => {
  const early = job(T + 50_000);
  const landed = landedOf(early.list(), T);
  assert.equal(landed, T + 50_000, "the job's row landed at 50 s");
  for (const at of [T + 50_000, T + 120_000, T + 600_000]) assert.equal(receiptLeft(early.endsAt, at, T, landed), "Done in 50 seconds.", `at ${(at - T) / 1000} s`);
  assert.equal(TIME_WORDS.underSecond, "Done in under a second.");

  const late = job(T + 270_000);
  const lateAt = landedOf(late.list(), T);
  assert.equal(receiptLeft(late.endsAt, T + 600_000, T, lateAt), "Done in 5 min.", "landed 30 s past the estimate: how long it took, never \"Slower than usual.\" later");

  const going = job(null);
  assert.equal(landedOf(going.list(), T), undefined, "control: still moving, not landed");
  assert.equal(receiptLeft(going.endsAt, T + 60_000, T, undefined), "About 3 min left.", "control: the time left");
  assert.equal(receiptLeft(going.endsAt, T + 270_000, T, undefined), TIME_WORDS.almost, "control: still moving past its estimate keeps the past-estimate words");
  assert.equal(receiptLeft(going.endsAt, T + 600_000, T, undefined), TIME_WORDS.slow, "control: still moving at over twice its estimate");
});

test("what counts as the receipt's job: the tap's starting row (ended when the real row takes over) never says landed; a row that stopped, or one made before the receipt opened, never either (controls)", () => {
  const rows = (extra: { id: string; state: string; startedAt: number; endedAt?: number }[]) => [{ id: "job:abc", state: "done", startedAt: T, endedAt: T + 1_500 }, ...extra];
  assert.equal(landedOf(rows([]), T), undefined, "only the handed-over starting row: not landed");
  assert.equal(landedOf(rows([{ id: "move:a", state: "failed", startedAt: T + 900, endedAt: T + 9_000 }]), T), undefined, "a row that stopped: not landed");
  assert.equal(landedOf(rows([{ id: "move:a", state: "done", startedAt: T + 900, endedAt: T + 9_000 }, { id: "move:b", state: "pending", startedAt: T + 900 }]), T), undefined, "one of two still going: not landed");
  assert.equal(landedOf([{ id: "move:old", state: "done", startedAt: T - 60_000, endedAt: T + 1_000 }], T), undefined, "a job from before the receipt: not its job");
  assert.equal(landedOf(rows([{ id: "move:a", state: "done", startedAt: T + 900, endedAt: T + 9_000 }, { id: "move:b", state: "done", startedAt: T + 900, endedAt: T + 20_000 }]), T), T + 20_000, "both landed: the last");
});

test("every receipt's clock is this one: TimeLeft follows its job in the shared store and stops once it landed; Home's money-on-its-way row has no job to follow", () => {
  const made = here("./JobMade.tsx");
  assert.match(made, /const read = \(\) => setLanded\(landedOf\(s\.list\(\), startMs, mine\)\);/);
  assert.match(made, /const time = receiptLeft\(endsAt, now, startMs, landed\);/);
  assert.match(made, /if \(endsAt === undefined \|\| landed !== undefined\) return;/, "the clock stops once landed");
  assert.match(here("../screens/Home.tsx"), /<Left etaSec=\{m\.etaSec\} endsAt=\{m\.endsAt\} follow=\{false\} line=\{movingWords\?\.sub\} \/>/);
});
