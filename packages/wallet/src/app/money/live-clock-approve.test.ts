// Audit 10's A8 (8 Nov), the Jobs row's side: the whole job's time carried from its Approve is a floor under the row's
// own leg estimate (its first frame knew only the first leg: "27 s left", then "59 s left"), and "Done in" counts from
// the Approve. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withCarry, onLegs, type LiveTrack } from "./live-steps.ts";

const track = (over: Partial<LiveTrack> = {}): LiveTrack => ({
  id: "j1", kind: "move", title: "Move 55.00 to your SOL wallet", wallets: ["safe", "sol"], startMs: 1_000, steps: [], ...over,
} as LiveTrack);

test("A8: the whole job's time from Approve is a floor under the leg estimate; Done counts from the Approve (controls: no whole carry keeps the protocol's quote; an ended row takes no time)", () => {
  const whole = 61_000, leg = 28_000;
  const t = withCarry(track({ endsAt: leg }), { endsAt: whole, whole: true, from: 1_500 });
  assert.equal(t.endsAt, whole, "the first frame says the whole job's time, never only the first leg");
  assert.equal(t.wholeEndsAt, whole);
  assert.equal(t.doneFrom, 1_500, "Done in counts from the Approve");
  const later = onLegs({ ...t, legSec: 20, steps: [{ label: "Signed", state: "done" }, { label: "Moving", state: "doing" }] } as LiveTrack);
  assert.ok(later.endsAt === undefined || later.endsAt >= whole, "the next leg never brings the time left below the whole job's");
  const plain = withCarry(track({ endsAt: leg }), { endsAt: whole });
  assert.equal(plain.endsAt, leg, "control: a carry with no Approve leaves the protocol's own quote");
  assert.equal(plain.doneFrom, undefined);
  const ended = withCarry(track({ endsAt: leg, end: { ok: true, line: "Done" } }), { endsAt: whole, whole: true });
  assert.equal(ended.wholeEndsAt, undefined, "control: an ended row takes no time");
});

test("A8 (QA 16): the Jobs row and the receipt read one clock, from the Approve to the landed read, counted the same way (control: the old row floored 5.4 s to \"5 s\" while the receipt said \"6 seconds\")", async () => {
  const { tookIn, rowTook } = await import("@zerofee/shell-api/job-steps.ts");
  const { shortElapsed } = await import("@zerofee/design/time.ts");
  const approve = 10_000, landed = approve + 5_400;
  const row = `Done in ${rowTook(landed - approve)}`;
  const receipt = tookIn(landed - approve);
  assert.equal(row, "Done in 6 s");
  assert.equal(receipt, "Took 6 s.");
  assert.equal(/\d+/.exec(row)![0], /\d+/.exec(receipt)![0], "one figure");
  assert.equal(shortElapsed(landed - approve), "5 s", "control: the old row's count");
  const { readFileSync } = await import("node:fs");
  const live = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(live, /const took = rowTook\(\(t\.endMs !== undefined && Number\.isFinite\(t\.endMs\) \? t\.endMs : now\) - from\);/, "the row counts as the receipt does, from the Approve (doneFrom)");
  const made = readFileSync(new URL("./JobMade.tsx", import.meta.url), "utf8");
  assert.match(made, /const begun = job \? carried\(job\)\?\.from \?\? taskStore\(\)\.list\(\)\.find\(\(r\) => r\.id === job\)\?\.startedAt : undefined;/, "the receipt counts from the job's own start (its Approve), never when it opened");
  assert.match(made, /receiptLeft\(endsAt, now, from, landed \?\? doneAt\)/);
});
