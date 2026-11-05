// The call budget and cache rules of the GeckoTerminal client: a busy screen never goes over the free tier, a 429 is respected, an old answer beats an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_MS, BURST_RESERVE, GROW_EVERY_MS, GT_BUDGET, LOW_SHARE, MIN_CAP, MarketError, createGt } from "./gt.ts";
import { replay, status } from "./testing.ts";

/** These tests check the per-minute window alone; the 10-second burst cap has its own test (persist.test.ts). */
const WINDOW_ONLY = { calls: 1_000, perMs: 10_000 };

const ok = [["/v2/x", { ok: true }]] as [string, unknown][];

test("a cached answer costs no call, and twenty callers of one path make one call", async () => {
  const r = replay(ok);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  await Promise.all(Array.from({ length: 20 }, () => gt.get("x", 30_000)));
  assert.equal(r.calls.length, 1);
  await gt.get("x", 30_000);
  assert.equal(r.calls.length, 1);
  r.clock.t += 31_000;
  await gt.get("x", 30_000);
  assert.equal(r.calls.length, 2);
});

test("never more than 25 calls in any 60 seconds: the 26th is refused (or served stale), then calls resume as the window slides", async () => {
  const r = replay([["/v2/p", () => ({ n: 1 })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  for (let i = 0; i < 25; i++) await gt.get(`p${i}`, 1_000);
  await assert.rejects(gt.get("p99", 1_000), (e: unknown) => e instanceof MarketError && e.code === "rate");
  assert.equal(r.calls.length, 25);
  // a path asked before is served from the old answer rather than failing
  r.clock.t += 5_000;
  assert.deepEqual(await gt.get("p0", 1_000), { n: 1 });
  assert.equal(r.calls.length, 25);
  r.clock.t += 56_000; // the first calls have left the window
  await gt.get("p99", 1_000);
  assert.equal(r.calls.length, 26);
  assert.ok(r.maxInWindow(GT_BUDGET.perMs) <= GT_BUDGET.calls);
});

test("background (low) calls stop at 60% of the window, so what the person just asked for always has room", async () => {
  const r = replay([["/v2/p", () => ({})]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  const lowCap = Math.floor(GT_BUDGET.calls * LOW_SHARE);
  for (let i = 0; i < lowCap + 5; i++) await gt.get(`p${i}`, 1_000, "low").catch(() => {});
  assert.equal(r.calls.length, lowCap);
  assert.equal(gt.stats().lowSkipped, 5);
  await gt.get("p-user", 1_000, "high"); // still allowed
  assert.equal(r.calls.length, lowCap + 1);
});

test("a 429 blocks every call until its retry-after has passed; the stale answer is served meanwhile", async () => {
  let limited = false;
  const r = replay([["/v2/a", () => (limited ? status(429, { "retry-after": "10" }) : { v: 1 })], ["/v2/b", { v: 2 }]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  await gt.get("a", 1_000);
  r.clock.t += 2_000; limited = true;
  assert.deepEqual(await gt.get("a", 1_000), { v: 1 }); // 429, stale served
  const n = r.calls.length;
  await assert.rejects(gt.get("b", 1_000), (e: unknown) => e instanceof MarketError && e.code === "rate");
  assert.equal(r.calls.length, n, "no call while blocked");
  r.clock.t += 11_000;
  assert.deepEqual(await gt.get("b", 1_000), { v: 2 });
});

test("a 404 is not_found and is not hidden behind a stale answer; any other failure serves the old answer up to 15 minutes", async () => {
  let down = false;
  const r = replay([["/v2/a", () => (down ? status(500) : { v: 1 })], ["/v2/missing", status(404)]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  await assert.rejects(gt.get("missing", 1_000), (e: unknown) => e instanceof MarketError && e.code === "not_found");
  await gt.get("a", 1_000);
  down = true; r.clock.t += 60_000;
  assert.deepEqual(await gt.get("a", 1_000), { v: 1 });
  r.clock.t += 16 * 60_000;
  await assert.rejects(gt.get("a", 1_000), (e: unknown) => e instanceof MarketError && e.code === "unreachable");
});

test("the budget adapts: each 429 cuts the window to 70% (never under 6), and it grows back one call per 20 s without a 429", async () => {
  let limited = false;
  const r = replay([["/v2/p", () => (limited ? status(429) : { n: 1 })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, burst: WINDOW_ONLY });
  assert.equal(gt.room(), 25);
  limited = true;
  await gt.get("p1", 1).catch(() => {});
  assert.equal(gt.room(), 0, "blocked right after a 429");
  r.clock.t += BLOCK_MS + 1;
  limited = false;
  assert.equal(gt.room(), Math.floor(25 * 0.7) - 1, "cap 17, one call already in the window");
  limited = true;
  for (let i = 0; i < 12; i++) { r.clock.t += BLOCK_MS + 1; await gt.get(`p-q${i}`, 1).catch(() => {}); }
  r.clock.t += BLOCK_MS + 1;
  assert.ok(gt.room() <= MIN_CAP + 2, `the cap fell to about ${MIN_CAP}`);
  limited = false;
  r.clock.t += 5 * GROW_EVERY_MS;
  assert.ok(gt.room() > MIN_CAP + 2, "grows back while nothing is refused");
  r.clock.t += 40 * GROW_EVERY_MS;
  assert.equal(gt.room(), 25, "up to the configured budget");
});

test("a screen's own call waits its turn behind the 10 s cap (and only the screen's: a list without a wait is refused at once)", async () => {
  const r = replay([["/v2/p", () => ({ n: 1 })]]);
  const sleeps: number[] = [];
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null, sleep: async (ms) => { sleeps.push(ms); r.clock.t += ms; } });
  for (let i = 0; i < 6; i++) await gt.get(`p${i}`, 1_000);
  await assert.rejects(gt.get("plist", 1_000), (e: unknown) => e instanceof MarketError && e.code === "rate");
  assert.deepEqual(await gt.get("pchart", 1_000, "high", { waitMs: 10_000 }), { n: 1 });
  assert.equal(sleeps.length, 1);
  assert.ok(r.maxInWindow(10_000) <= 6, "the wait spends no more than the cap");
  // a wait longer than allowed fails at once rather than hanging the screen
  for (let i = 0; i < 5; i++) await gt.get(`pq${i}`, 1_000);
  await assert.rejects(gt.get("pchart2", 1_000, "high", { waitMs: 500 }), (e: unknown) => e instanceof MarketError && e.code === "rate");
});

test("a clock that doesn't move never waits forever", async () => {
  const r = replay([["/v2/p", () => ({ n: 1 })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null, sleep: async () => undefined });
  for (let i = 0; i < 6; i++) await gt.get(`p${i}`, 1_000);
  await assert.rejects(gt.get("pchart", 1_000, "high", { waitMs: 10_000 }), (e: unknown) => e instanceof MarketError && e.code === "rate");
});

test("a screen's call that meets a 429 tries once more after the pause, if the pause ends inside its wait", async () => {
  let n = 0;
  const r = replay([["/v2/p", () => (++n === 1 ? status(429) : { n })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null, sleep: async (ms) => { r.clock.t += ms; } });
  assert.deepEqual(await gt.get("pchart", 1_000, "high", { waitMs: BLOCK_MS + 5_000 }), { n: 2 });
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1]!.at - r.calls[0]!.at >= BLOCK_MS, "not before the pause ends");
  n = 0;
  await assert.rejects(gt.get("pother", 1_000, "high", { waitMs: 1_000 }), (e: unknown) => e instanceof MarketError && e.code === "rate");
});

test("background calls never take the last calls of the 10 s cap: the screen still has room right after them", async () => {
  const r = replay([["/v2/p", () => ({ n: 1 })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null });
  const low = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => gt.get(`pbg${i}`, 1_000, "low")));
  assert.equal(low.filter((x) => x.status === "fulfilled").length, 6 - BURST_RESERVE);
  assert.equal(gt.room("low"), 0);
  assert.equal(gt.room("high"), BURST_RESERVE);
  assert.deepEqual(await gt.get("pscreen", 1_000), { n: 1 });
});

test("a coin page opened right after a busy list: its token, its info and its chart's candles all go at once (test, 4 Nov)", async () => {
  const r = replay([["/v2/p", () => ({ n: 1 })]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null });
  await Promise.allSettled(Array.from({ length: 10 }, (_, i) => gt.get(`pwarm${i}`, 1_000, "low")));
  const page = await Promise.allSettled(["ptoken", "pinfo", "pohlcv"].map((p) => gt.get(p, 1_000, "high")));
  assert.deepEqual(page.map((x) => x.status), ["fulfilled", "fulfilled", "fulfilled"]);
});
