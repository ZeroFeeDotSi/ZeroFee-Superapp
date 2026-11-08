// QA 16's MUST on builder 12's shots (8 Nov, one clock, one wording): the job tracker page of a done Send or Move said "Done
// in 6 seconds." while its receipt says "Took 6 s." and its Jobs row "Done in 6 s"; a Move's last step said "Done in 6
// seconds." too. Now both say "Took 6 s.", the receipt's words. AgentZero's funding receipt shares that clock
// (receiptLeft), so it takes the same head once landed: "Done.". Trade's and the native screens' receipts draw their own
// head and clock (trade format.ts doneIn, NativeScreens, ShortChain): left as they are. Fails on main: "Done in 6 seconds.".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobFace } from "./job-face.ts";

const T = Date.UTC(2026, 10, 8, 1, 30);

test("the tracker page of a done job says how long it took as the receipt does [before: Done in 6 seconds.]", () => {
  const done = { id: "send:s1", kind: "send", title: "Send $5.00 to bob.near", wallets: ["safe"], startMs: T, endMs: T + 5_400, steps: [{ label: "Paid to bob.near", state: "done" }], end: { ok: true, line: "Paid to bob.near." } };
  assert.equal(jobFace(done as never).took, "Took 6 s.");
  const quick = { ...done, endMs: T + 300 };
  assert.equal(jobFace(quick as never).took, "Took under a second.");
  assert.equal(jobFace({ ...done, end: undefined, endMs: undefined, steps: [{ label: "Paying", state: "doing" }] } as never).took, undefined, "control: going, none");
});

test("a Move's last step and AgentZero's landed head read the receipt's words (source pins)", () => {
  const steps = readFileSync(new URL("./live-steps.ts", import.meta.url), "utf8");
  assert.match(steps, /doneIn: \(ms: number\) => tookIn\(ms\),/);
  assert.match(steps, /W\.doneIn\(end\)/);
  const az = readFileSync(new URL("../../../../agent/src/app/AgentApp.tsx", import.meta.url), "utf8");
  assert.match(az, /\{funded\.landedAt !== undefined && !funded\.slow \? JOB_WORDS\.landed : JOB_WORDS\.created\}/);
});
