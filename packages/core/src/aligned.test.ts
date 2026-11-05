import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { everyAligned } from "./aligned.ts";

/** Advance the mock clock 1 ms at a time, so a timer set inside a firing timer is run in the same advance. */
const advance = (ms: number) => {
  for (let i = 0; i < ms; i++) mock.timers.tick(1);
};

// Deterministic (no wall clock): node:test's mock timers drive setTimeout and Date together, so the beat is exact and a
// busy machine can't make two real timers drift apart (the old version failed land.sh under load, 2 Nov).
test("two timers with the same period tick together, on the clock's multiples of it, and stop when told", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    const a: number[] = [];
    const b: number[] = [];
    const stopA = everyAligned(40, () => a.push(Date.now()));
    advance(13);
    const stopB = everyAligned(40, () => b.push(Date.now()));
    advance(190);
    stopA();
    stopB();
    assert.ok(a.length >= 3 && b.length >= 3, `${a.length} and ${b.length} ticks`);
    for (const t of [...a, ...b]) assert.equal(t % 40, 0, `tick ${t} is on a multiple of 40`);
    assert.deepEqual(a.slice(-b.length), b, "the same beats, at the same moments");
    const was = a.length;
    advance(100);
    assert.equal(a.length, was, "stopped");
  } finally {
    mock.timers.reset();
  }
});

test("the first tick waits for the next beat, from the given clock", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let at = 1_000_030;
    const ticks: number[] = [];
    const stop = everyAligned(50, () => ticks.push(at), () => at);
    // 20 ms to the next multiple of 50 (1,000,050): nothing before it.
    advance(19);
    assert.equal(ticks.length, 0);
    at = 1_000_050;
    advance(1);
    stop();
    assert.equal(ticks.length, 1);
  } finally {
    mock.timers.reset();
  }
});
