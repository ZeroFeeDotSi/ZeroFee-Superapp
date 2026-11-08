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
  assert.match(sheet, /const job = madeState\(runs, legs, follow\?\.length \?\? 0, fillsFirst\);/);
  assert.match(sheet, /wl-mv-made" data-state=\{said\.landed \? "landed" : job\.state\}/, "fails before: data-state=\"away\" always");
  assert.match(sheet, /if \(job\.etaSec !== null && madeAt !== null\) lastEnds\.current = madeAt \+ job\.etaSec \* 1000;/);
  assert.match(sheet, /\{ends !== undefined \? <TimeLeft endsAt=\{ends\} watch job=\{madeJob\} doneAt=\{said\.landed \? doneAt\.current : undefined\} \/>/);
  assert.doesNotMatch(sheet, /<TimeLeft etaSec=\{Math\.max\(0, \.\.\.legs\.map\(legTime\)\)\} \/>/, "fails before: the plan's own countdown");
  // J2-4 (copy review, 8 Nov): "It keeps going" follows TimeLeft's own landing, never a line of its own under "Done in 6 seconds."
  assert.match(sheet, /<TimeLeft etaSec=\{job\.etaSec\} watch job=\{madeJob\}/, "control: \"It keeps going\" only while it does");
  assert.doesNotMatch(sheet, /\{job\.state === "away" && <p className="zf-receipt__line">\{JOB_WORDS\.watch\}<\/p>\}/);
});

// audit 13's D1 (8 Nov): the landed receipt said "Job created." and "Moving it to your SOL wallet." beside "Took 6 s.": the
// Jobs rows (TimeLeft's clock) had landed while the legs read off Activity (madeState) had not. One rule now: either landed it.
import { moveReceiptWords } from "../money/receipt-said.ts";
test("D1: Move's receipt says Done once its rows OR its legs landed (fails on main: no moveReceiptWords, the head was always Job created.)", () => {
  const who = "NEAR Confidential moves it. Solana lands it.";
  const going = moveReceiptWords({ legs: false, rows: false, where: "your SOL wallet", who });
  assert.deepEqual(going, { landed: false, head: "Job created.", title: "Moving it to your SOL wallet.", who });
  const done = { landed: true, head: "Done.", title: "It's now in your SOL wallet.", who: "It went there through NEAR Confidential." };
  assert.deepEqual(moveReceiptWords({ legs: false, rows: true, where: "your SOL wallet", who }), done, "the rows landed first (the audit's shot)");
  assert.deepEqual(moveReceiptWords({ legs: true, rows: false, where: "your SOL wallet", who }), done, "the legs landed first");
  assert.match(sheet, /const rowsState = useReceiptState\(madeJob !== null, madeJob\);/);
  assert.match(sheet, /data-testid="move-made-head">\{said\.head\}</);
  assert.doesNotMatch(sheet, /zf-receipt__head">\{JOB_WORDS\.created\}/, "fails on main: the head never changed");
});
