// QA 16's tick 51 (8 Nov), builder 12's M12-1 and M12-2, on b11's light shots c08 and c10. The Swap receipt, landed, still
// said "Job created." over "About 0.0103 ETH is in your Robinhood wallet." and "Done in 11 seconds."; the Activity row of
// the same done Swap kept "About 0.0103 ETH came into your Robinhood wallet.". A landed receipt says "Done.", the figure
// read off the record (no "About") and how long it took ("Took 11 s."); a done row says the read figure. While the job
// goes: "Job created.", the estimate and the time left. Fails on main: no JOB_WORDS.landed, "Done in", the estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { receiptLeft, rowTook, tookIn } from "@zerofee/shell-api/job-steps.ts";

const T = Date.UTC(2026, 10, 8, 0, 40, 0);
const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");

test("M12-1: a landed receipt's time is how long it took, the Jobs row's own figure [before: \"Done in 11 seconds.\" under \"Job created.\"]", () => {
  assert.equal(receiptLeft(T + 20_000, T + 60_000, T, T + 10_400), "Took 11 s.");
  assert.equal(`Took ${rowTook(10_400)}.`, tookIn(10_400), "one count with the row (\"11 s\")");
  assert.equal(receiptLeft(T + 20_000, T + 60_000, T, T + 400), "Took under a second.");
  assert.equal(receiptLeft(T + 600_000, T + 600_000, T, T + 150_000), "Took 3 min.");
  assert.equal(receiptLeft(T + 20_000, T, T, undefined), "About 20 seconds left.", "control: going, the time left");
  assert.equal(JOB_WORDS.landed, "Done.");
  assert.equal(JOB_WORDS.created, "Job created.", "control: going");
});

test("M12-1: the receipt's head and protocol line follow the job: \"Done.\" and the past once it landed (source pin; the mounted test renders it)", () => {
  assert.match(made, /\{landed \? JOB_WORDS\.landed : JOB_WORDS\.created\}/);
  assert.match(made, /landed && through === THROUGH_CONFIDENTIAL \? WENT_CONFIDENTIAL : through/);
  assert.match(made, /const state = useReceiptState\(true, job\);/, "the head follows the job even with no said line");
});

test("M12-1: the Swap's landed line never says the tap's estimate: no figure until the record is read [before: About 0.0103 ETH under Done]", () => {
  assert.match(sheet, /landed: swappedLine\(undefined, SWAP_COIN\[get\]\.where\) \}\)/);
  assert.doesNotMatch(sheet, /landed: swappedLine\(lands, SWAP_COIN\[get\]\.where\)/);
  // its read follows the job's rows (the store), not only the 2 s clock
  assert.match(sheet, /const off = taskStore\(\)\.subscribe\(\(\) => void read\(\)\);/);
});

