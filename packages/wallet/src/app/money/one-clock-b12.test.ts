// QA 16's MUST on builder 12's shots (8 Nov, owner's one-clock rule): the going Swap receipt said "About 1 min left." while
// its Jobs row said "3 min left": the receipt counted from its own tap-time estimate, the row from the job's rows. Now the
// receipt reads the job's own rows' end (jobEndsAt), the time the Jobs row counts down to (set from the Approve for a Safe
// job, then the core's row's). Fails on main: no jobEndsAt; TimeLeft counts only its own estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobEndsAt, receiptLeft, timeLeft } from "@zerofee/shell-api/job-steps.ts";

const T = Date.UTC(2026, 10, 8, 1, 30);
const mine = (id: string) => id === "job:a" || id === "move:mv-1";

test("one clock: the receipt's end is its Jobs row's [before: About 1 min left. beside 3 min left]", () => {
  const rows = [{ id: "move:mv-1", state: "pending", endsAt: T + 180_000 }, { id: "move:other", state: "pending", endsAt: T + 600_000 }];
  const ends = jobEndsAt(rows, mine)!;
  assert.equal(ends, T + 180_000, "its own row, never another job's");
  assert.equal(timeLeft(ends, T), "3 min left");
  assert.equal(receiptLeft(ends, T), "About 3 min left.", "the same figure as the row");
  // controls: a row done or with no end gives none (the receipt keeps its tap-time estimate)
  assert.equal(jobEndsAt([{ id: "move:mv-1", state: "done", endsAt: T + 180_000 }], mine), undefined);
  assert.equal(jobEndsAt([{ id: "move:mv-1", state: "pending" }], mine), undefined);
  // the starting row still on the list beside the core's row: the core's, as the Jobs list shows it
  assert.equal(jobEndsAt([{ id: "job:a", state: "pending", endsAt: T + 181_000 }, ...rows], mine), T + 180_000);
  assert.equal(jobEndsAt([{ id: "job:a", state: "pending", endsAt: T + 60_000 }], mine), T + 60_000, "before the core answers: the starting row's");
});

test("one clock: TimeLeft takes the job's rows' end before its own estimate (source pin)", () => {
  const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  assert.match(made, /const read = \(\) => setRowEnds\(jobEndsAt\(s\.list\(\), mine\)\);/);
  assert.match(made, /const endsAt = own !== undefined && Number\.isFinite\(own\) \? own : rowEnds \?\? fromNow;/);
});

test("one tick: the receipt and the Jobs row both tick just after the wall-clock second, so they say one figure [before: 57 seconds over 56 s]", async () => {
  const { onSecond } = await import("@zerofee/shell-api/job-steps.ts");
  const E = T + 60_400;
  // two clocks whose last ticks fell anywhere in a second say two figures; ticked on the second, one
  const at = (n: number) => Math.ceil((E - n) / 1000);
  assert.notEqual(at(T + 3_100), at(T + 3_500), "control: ticks 0.4 s apart say 58 and 57");
  assert.equal(at(T + 3_005), at(T + 3_005), "on the same second, one figure");
  for (const now of [T + 3_100, T + 3_999, T + 3_000]) {
    const next = now + onSecond(1000, now);
    assert.equal(next % 1000, 5, "lands 5 ms after the second");
  }
  assert.equal((T + 3_250 + onSecond(15_000, T + 3_250)) % 1000, 5, "the 15 s pace too");
  const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  const centre = readFileSync(new URL("../../../../shell-api/src/TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(made, /t = setTimeout\(tick, onSecond\(1000, Date\.now\(\)\)\);/);
  assert.match(centre, /setTimeout\(\(\) => setAt\(Date\.now\(\)\), onSecond\(tickEvery\(youngest\), Date\.now\(\)\)\)/);
});
