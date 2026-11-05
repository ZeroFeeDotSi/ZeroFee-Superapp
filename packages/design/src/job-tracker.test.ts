// The one tracker (JOB-TRACKER-SPEC 5 Nov): the Receipt's states on top, the steps' marks, the step times in words, the
// lit verb only when there is one, and the crawl's step marks. Source and CSS pins with controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markStep, stepTime } from "./job-steps.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const src = read("./JobTracker.tsx");
const css = read("./job-tracker.css");

test("the step's time in words: tenths under 10 s, seconds under a minute, minutes after; never a clock face", () => {
  assert.equal(stepTime(620), "0.6 s");
  assert.equal(stepTime(41_000), "41 s");
  assert.equal(stepTime(125_000), "2 min");
  assert.doesNotMatch(stepTime(125_000), /:/, "control: no 2:05");
});

test("the job's state is the Receipt's: ReceiptMark on top, mark(state) once per state; landed is never set here (the caller's chain answer)", () => {
  assert.match(src, /<ReceiptMark state=\{state\} icon=\{<CoinIcon symbol=\{coin\.symbol\} icon=\{coin\.icon\} src=\{coin\.src\} size=\{Math\.round\(ring \* 0\.54\)\} \/>\} size=\{ring\} \/>/);
  assert.match(src, /useEffect\(\(\) => \{ mark\(state\); \}, \[state\]\);/);
  assert.doesNotMatch(src, /state = "landed"|setState\("landed"\)/, "the tracker draws; it never decides landed");
  assert.match(src, /state: ReceiptState;/, "control: the four states are the Receipt's type");
});

test("the steps: hairline rows with the engine's own time only once done; the live dot is the only moving mark", () => {
  assert.match(src, /\{s\.state === "done" && s\.atMs !== undefined \? stepTime\(s\.atMs\) : ""\}/, "no time while doing or waiting, never a made-up one");
  assert.match(src, /if \(state === "doing"\) return <span className="zf-job__mark is-doing" aria-hidden="true"><span className="zf-live" \/><\/span>;/);
  assert.match(css, /\.zf-job__step \{ display: grid; grid-template-columns: 24px minmax\(0, 1fr\) auto; .*border-bottom: 1px solid var\(--line\)/);
  assert.doesNotMatch(css, /animation:/, "control: no animation of its own (the live dot's is motion.css's)");
  assert.doesNotMatch(css, /border-radius: (1[0-9]|2[0-9])px|box-shadow: var\(--e-/, "no card, no box");
});

test("the lit verb only when there is one: Done once landed or checking, Try again (+ quiet Close) once refused, none while away", () => {
  assert.match(src, /const over = state === "landed" \|\| state === "refused" \|\| state === "checking";/);
  assert.match(src, /\{over && \(onDone \|\| onAgain\) && \(/);
  assert.match(src, /state === "refused" && onAgain && <button type="button" className="zf-btn" onClick=\{onAgain\}>Try again<\/button>/);
  assert.match(src, /state !== "refused" && onDone && <button type="button" className="zf-btn" onClick=\{onDone\}>Done<\/button>/);
});

test("the crawl's step marks: step:<key>:<state> on performance and in window.__zfTap, once per state change", () => {
  const g = globalThis as { __zfTap?: { mark: string; t: number }[] };
  g.__zfTap = [];
  markStep("intents", "doing");
  markStep("intents", "done");
  assert.deepEqual(g.__zfTap.map((m) => m.mark), ["step:intents:doing", "step:intents:done"]);
  assert.match(src, /if \(seen\.current\[s\.key\] !== s\.state\) \{ seen\.current\[s\.key\] = s\.state; markStep\(s\.key, s\.state\); \}/, "a re-render with the same states marks nothing again");
  delete g.__zfTap;
});
