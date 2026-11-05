// QA's real-money lap (5 Nov, move2.log): a NEAR wallet → Safe Move's first Jobs frame read
// "Moving $2.11 to your Safe · Arriving in your Safe · No time estimate" for 0.5 s, before its job's carry came. With no
// quote and no carry, the row counts down the route's measured time (LEG_SEC); the job's own carry still wins. Fixed clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { LEG_SEC, TIME_WORDS, timeLeft } from "@zerofee/shell-api/job-steps.ts";
import { moveTrack, withCarry } from "./live-steps.ts";

const AT = Date.parse("2026-11-05T08:37:19Z");
const home: SpendingActivity = { id: "pa-1", kind: "put-away", usd: "2.11", status: "on-its-way", atIso: new Date(AT).toISOString(), words: "Put away $2.11", network: "near" } as SpendingActivity;

test("no quote and no carry: the first frame counts down the route's measured time, never \"No time estimate\"; the job's carry still wins (control: a quoted row keeps its quote)", () => {
  const t = withCarry(moveTrack(home, undefined, undefined)!, undefined);
  assert.equal(t.endsAt, AT + LEG_SEC.nearToSafe * 1000, "NEAR wallet → Safe: its measured 10 s");
  assert.notEqual(timeLeft(t.endsAt, AT + 1000), TIME_WORDS.none, "never 'No time estimate' (the row's line, LiveTrack rowLine)");
  assert.match(timeLeft(t.endsAt, AT + 1000), /9 s left/);
  assert.equal(timeLeft(undefined, AT), TIME_WORDS.none, "control: what it said before");
  // the job's own carry (its dollars and time from the tap) still wins over the measured time
  const c = withCarry(moveTrack(home, undefined, undefined)!, { usd: "$2.04", endsAt: AT + 7000 });
  assert.equal(c.endsAt, AT + 7000);
  assert.match(c.title, /\$2\.04/, "the job's dollars");
  // control: a row with the protocol's own quote keeps it
  const q = withCarry(moveTrack({ ...home, etaSeconds: 25 }, undefined, undefined)!, { endsAt: AT + 7000 });
  assert.equal(q.endsAt, AT + 25_000);
  // control: an ended row has no time left
  assert.equal(withCarry(moveTrack({ ...home, status: "done" }, undefined, undefined)!, undefined).endsAt, undefined);
});
