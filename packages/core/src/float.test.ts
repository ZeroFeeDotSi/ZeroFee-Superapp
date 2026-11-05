import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_MOVES_PER_DAY, FLOAT_NO_SHEET_USD_PER_DAY, FloatGuard } from "./float.ts";
import { utf8 } from "./sol/bytes.ts";
import { MemoryVault } from "./vault.ts";

const HOUR = 3_600_000;

function guard(start = Date.parse("2026-10-27T00:00:00Z")) {
  let now = start;
  const vault = new MemoryVault();
  return { g: new FloatGuard(vault, () => now), vault, later: (ms: number) => (now += ms) };
}

test("the fee guard: 20 moves in 24 hours go without asking, then each one asks", async () => {
  const { g } = guard();
  for (let i = 0; i < FLOAT_MOVES_PER_DAY; i++) assert.equal((await g.take(5)).ask, false, `move ${i + 1}`);
  assert.equal(await g.left(), 0);
  assert.equal((await g.take(5)).ask, true);
  assert.equal((await g.take(500)).ask, true, "a bigger move doesn't skip the question");
});

test("the fee guard: nothing under $2, and no amount it can't read", async () => {
  const { g } = guard();
  for (const usd of [1.99, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(g.take(usd), (e: any) => e.problem.code === "security.request.not-allowed", String(usd));
  }
  assert.equal(await g.left(), 20, "a refused move uses nothing");
  assert.equal((await g.take(2)).ask, false);
});

test("the fee guard: a move that was never signed gives its place back", async () => {
  const { g } = guard();
  const held = await g.take(5);
  assert.equal(await g.left(), 19);
  await held.release();
  assert.equal(await g.left(), 20);
});

test("the fee guard: the window rolls; each move frees its place 24 hours after it", async () => {
  const { g, later } = guard();
  for (let i = 0; i < 10; i++) await g.take(5);
  later(12 * HOUR);
  for (let i = 0; i < 10; i++) await g.take(5);
  assert.equal(await g.left(), 0);
  later(12 * HOUR + 1);
  assert.equal(await g.left(), 10, "the first ten are 24 hours old");
  later(12 * HOUR);
  assert.equal(await g.left(), 20);
});

test("the fee guard: moves asked at the same time can't both take the last place", async () => {
  const { g } = guard();
  for (let i = 0; i < FLOAT_MOVES_PER_DAY - 1; i++) await g.take(5);
  const answers = await Promise.all(Array.from({ length: 5 }, () => g.take(5)));
  assert.deepEqual(answers.map((a) => a.ask), [false, true, true, true, true]);
});

test("the fee guard: an unreadable record counts as all 20 used, never as none", async () => {
  for (const raw of ["not json", "{}", '[{"at":"soon","id":1}]']) {
    const { g, vault, later } = guard();
    await vault.put("float-moves", utf8(raw));
    assert.equal(await g.left(), 0, raw);
    assert.equal((await g.take(5)).ask, true, raw);
    later(24 * HOUR + 1);
    assert.equal(await g.left(), 20, `${raw}: the day passes as for real moves`);
  }
});

test("the fee guard: setting the clock back doesn't free the day", async () => {
  const { g, later } = guard();
  for (let i = 0; i < FLOAT_MOVES_PER_DAY; i++) await g.take(5);
  later(-6 * HOUR);
  assert.equal(await g.left(), 0);
});

test("the dollar budget: $1,000 in 24 hours moves without asking, then each move asks; money going home doesn't count", async () => {
  const { g, later } = guard();
  assert.equal(FLOAT_NO_SHEET_USD_PER_DAY, 1000);
  assert.deepEqual([(await g.take(600)).ask, (await g.take(400)).ask], [false, false], "exactly $1,000 goes");
  const past = await g.take(2);
  assert.deepEqual([past.ask, past.why], [true, "dollars"]);
  // A move it asked about and was never signed gives its dollars back too.
  await past.release();
  const home = await g.take(5_000, false);
  assert.equal(home.ask, false, "home: no dollar question");
  later(24 * 3_600_000 + 1);
  assert.equal((await g.take(900)).ask, false, "the window rolls");
  // The move count still asks first when both are used.
  const { g: busy } = guard();
  for (let i = 0; i < FLOAT_MOVES_PER_DAY; i++) await busy.take(2);
  assert.equal((await busy.take(2_000)).why, "moves");
});

test("the dollar budget: a record whose dollars can't be read counts as the whole day used", async () => {
  const { g, vault } = guard();
  await vault.put("float-moves", utf8(JSON.stringify([{ at: Date.parse("2026-10-27T00:00:00Z"), id: "x", usd: "lots" }])));
  assert.equal(await g.left(), 0);
});
