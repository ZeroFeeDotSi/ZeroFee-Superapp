import { test } from "node:test";
import assert from "node:assert/strict";
import { epochStartOf, secondsPerBlock, timeOfHeight, unlockHeight, waitNow, type EpochNow } from "./epoch.ts";

const e = (height: number): EpochNow => ({
  startHeight: 1_000_000,
  length: 43_200,
  head: { hash: "h", height, timestampNs: 1_800_000_000_000_000_000n },
  blockSeconds: 0.5723,
});

test("the epoch a block falls in, before and after the current one", () => {
  assert.equal(epochStartOf(1_000_000, e(1_010_000)), 1_000_000);
  assert.equal(epochStartOf(1_043_199, e(1_010_000)), 1_000_000);
  assert.equal(epochStartOf(1_043_200, e(1_010_000)), 1_043_200);
  assert.equal(epochStartOf(999_999, e(1_010_000)), 956_800);
  assert.equal(epochStartOf(956_800, e(1_010_000)), 956_800);
});

test("unstaked NEAR unlocks at its epoch plus four, so it waits three to four epochs", () => {
  assert.equal(unlockHeight(1_000_000, e(1_000_000)), 1_172_800);
  assert.equal(unlockHeight(1_043_199, e(1_000_000)), 1_172_800);
  const start = waitNow(e(1_000_000));
  const end = waitNow(e(1_043_199));
  assert.equal(start.epochHours, 6.9);
  assert.equal(start.minHours, 20.6);
  assert.equal(start.maxHours, 27.5);
  const hours = (w: typeof start, at: EpochNow) => (Date.parse(w.ifNowIso) - Number(at.head.timestampNs / 1_000_000n)) / 3.6e6;
  assert.ok(Math.abs(hours(start, e(1_000_000)) - 27.47) < 0.01, "asked at the start of an epoch: four epochs");
  assert.ok(Math.abs(hours(end, e(1_043_199)) - 20.6) < 0.01, "asked at its very end: three");
});

test("a time is never before the head block", () => {
  const now = e(1_010_000);
  assert.equal(timeOfHeight(900_000, now), Number(now.head.timestampNs / 1_000_000n));
});

test("seconds per block come from the blocks' own timestamps", () => {
  const a = { hash: "a", height: 100, timestampNs: 0n };
  const b = { hash: "b", height: 43_300, timestampNs: 24_723_360_000_000n };
  assert.equal(secondsPerBlock(a, b), 0.5723);
  assert.throws(() => secondsPerBlock(b, a));
});
