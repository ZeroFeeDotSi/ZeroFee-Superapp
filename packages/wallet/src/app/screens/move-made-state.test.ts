// the copy review's Sim re-walk (5 Nov): Move's receipt said "About 20 s left" after the SOL wallet had landed at +10 s: it ran its own
// countdown from the plan. Now it reads the job's legs (Activity's runs): Done the moment they landed, and the time left
// is only the legs still moving, counted from when the job was made. No clock here: the state is a pure read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { legTime, madeState, MOVE_WORDS, type Leg, type Run } from "./move-split.ts";

const toSol: Leg = { from: "private", to: "sol", usd: 5 } as Leg;
const toEth: Leg = { from: "sol", to: "safe", usd: 5 } as Leg;
const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");

test("the receipt is Done when its job's legs landed (fails before: it kept the plan's countdown); control: still moving keeps a time", () => {
  const landed: Run[] = [{ leg: toSol, state: "done" }];
  assert.deepEqual(madeState(landed, [toSol], 1), { state: "landed", etaSec: null });
  assert.deepEqual(madeState([{ leg: toSol, state: "moving" }], [toSol], 1), { state: "away", etaSec: legTime(toSol) }, "control: on its way, its own time");
  assert.deepEqual(madeState([], [toSol, toEth], 0), { state: "away", etaSec: Math.max(legTime(toSol), legTime(toEth)) }, "control: before the ids are back, the plan's legs");
  assert.deepEqual(madeState([{ leg: toSol, state: "done" }, { leg: toEth, state: "moving" }], [toSol, toEth], 2), { state: "away", etaSec: legTime(toEth) }, "a landed leg's time is gone");
  assert.deepEqual(madeState([{ leg: toSol, state: "stopped" }], [toSol], 1), { state: "away", etaSec: null }, "control: a stopped leg is never \"About … left\"");
  assert.equal(MOVE_WORDS.done, "Done");
});

test("MoveSheet draws the job's state: data-state from it, Done in place of the time, one clock from when the job was made", () => {
  assert.match(sheet, /const job = madeState\(runs, legs, follow\?\.length \?\? 0\);/);
  assert.match(sheet, /wl-mv-made" data-state=\{job\.state\}/, "fails before: data-state=\"away\" always");
  assert.match(sheet, /\{job\.state === "landed" \? <p className="zf-receipt__line" data-testid="move-made-landed">\{MOVE_WORDS\.done\}<\/p> : job\.etaSec !== null && <TimeLeft \{\.\.\.\(madeAt !== null \? \{ endsAt: madeAt \+ job\.etaSec \* 1000 \}/);
  assert.doesNotMatch(sheet, /<TimeLeft etaSec=\{Math\.max\(0, \.\.\.legs\.map\(legTime\)\)\} \/>/, "fails before: the plan's own countdown");
  assert.match(sheet, /\{job\.state === "away" && <p className="zf-receipt__line">\{JOB_WORDS\.watch\}<\/p>\}/, "control: \"It keeps going\" only while it does");
});
