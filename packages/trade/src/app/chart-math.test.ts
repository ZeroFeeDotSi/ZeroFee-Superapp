// The chart's arithmetic: candles fitted to the space, the candle under a finger, the live price, a coin's age.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../market/types.ts";
import { ageText, fitCandles, indexAt, withLive } from "./chart-math.ts";

const c = (t: number, o: number, h: number, l: number, cl: number, v: number): Candle => ({ t, o, h, l, c: cl, v });

test("candles fitted to the space: neighbours merge, the first open, the last close, the high, low and volume across", () => {
  const six = [c(1, 10, 12, 9, 11, 1), c(2, 11, 15, 10, 14, 2), c(3, 14, 14, 8, 9, 3), c(4, 9, 10, 7, 8, 4), c(5, 8, 20, 8, 19, 5), c(6, 19, 19, 18, 18, 6)];
  assert.deepEqual(fitCandles(six, 3), [c(1, 10, 15, 9, 14, 3), c(3, 14, 14, 7, 8, 7), c(5, 8, 20, 8, 18, 11)]);
  assert.equal(fitCandles(six, 10), six, "fewer than the space: as they are");
});

test("the candle under a finger, at either edge and between", () => {
  assert.equal(indexAt(0, 345, 10), 0);
  assert.equal(indexAt(344.9, 345, 10), 9);
  assert.equal(indexAt(-5, 345, 10), 0);
  assert.equal(indexAt(400, 345, 10), 9);
  assert.equal(indexAt(172.5, 345, 10), 5);
});

test("LIVE: the price now joins the newest candle, never another", () => {
  const cs = [c(1, 1, 2, 1, 2, 1), c(2, 2, 3, 2, 3, 1)];
  assert.deepEqual(withLive(cs, 3.5).at(-1), c(2, 2, 3.5, 2, 3.5, 1));
  assert.deepEqual(withLive(cs, 1.5).at(-1), c(2, 2, 3, 1.5, 1.5, 1));
  assert.equal(withLive(cs, undefined), cs);
  assert.deepEqual(withLive(cs, 3.5)[0], cs[0]);
});

test("a coin's age in plain words", () => {
  const H = 3_600_000, D = 24 * H;
  assert.equal(ageText(1), "1 hour");
  assert.equal(ageText(5 * H), "5 hours");
  assert.equal(ageText(1 * D), "1 day");
  assert.equal(ageText(14 * D), "14 days");
  assert.equal(ageText(120 * D), "3 months");
  assert.equal(ageText(1000 * D), "2 years");
});

import { agoText } from "./chart-math.ts";
test("a trade's age, short", () => {
  assert.deepEqual([0, 9_999, 40_000, 3 * 60_000 + 5_000, 2 * 3_600_000, 5 * 86_400_000, -50].map(agoText), ["now", "now", "40 s", "3 min", "2 h", "5 d", "now"]);
});

import { CHART_REFRESH_MS } from "./chart-math.ts";
test("LIVE on a page left open (audit 2 Nov): a price past the newest candle's slot opens its own candle, never repaints an old one", () => {
  const M = 60_000, t0 = Date.parse("2026-11-02T02:00:00Z");
  const cs = [c(t0, 1, 2, 1, 2, 5), c(t0 + M, 2, 3, 2, 3, 5), c(t0 + 2 * M, 3, 3, 2.5, 2.8, 5)];
  // inside the newest minute: the newest candle, as before
  assert.deepEqual(withLive(cs, 3.1, t0 + 2 * M + 30_000).at(-1), c(t0 + 2 * M, 3, 3.1, 2.5, 3.1, 5));
  // ten minutes later: a candle at that minute, opening at the last close, with no volume of its own
  const later = withLive(cs, 3.4, t0 + 12 * M + 5_000);
  assert.equal(later.length, cs.length + 1);
  assert.deepEqual(later.at(-1), c(t0 + 12 * M, 2.8, 3.4, 2.8, 3.4, 0));
  assert.deepEqual(later.slice(0, -1), cs, "the candles that were there are untouched");
  // a minute with no trades has no candle: the slot is the smallest gap, not the last one
  const gappy = [c(t0, 1, 1, 1, 1, 1), c(t0 + M, 1, 1, 1, 1, 1), c(t0 + 5 * M, 1, 1, 1, 1, 1)];
  assert.equal(withLive(gappy, 2, t0 + 6 * M + 1).at(-1)!.t, t0 + 6 * M);
  // one candle, or no time given: the newest candle, as before
  assert.equal(withLive([cs[0]!], 9, t0 + 50 * M).length, 1);
  assert.equal(withLive(cs, 9).length, cs.length);
});

import { chartTime } from "./chart-math.ts";
test("audit 2 Nov: the chart's axis reads the device's clock, not UTC: 03:05 on a phone in another time zone is drawn at 03:05", () => {
  const t = Date.parse("2026-11-01T18:05:00Z");                       // 03:05 on 2 Nov in another time zone (offset -540)
  assert.equal(new Date(chartTime(t, -540) * 1000).toISOString().slice(11, 16), "03:05");
  assert.equal(chartTime(t, 0), t / 1000, "a UTC device: as it is");
  assert.equal(new Date(chartTime(t, 300) * 1000).toISOString().slice(11, 16), "13:05", "New York in winter (UTC-5)");
  const one = [t, t + 60_000, t + 120_000].map((x) => chartTime(x, -540));
  assert.deepEqual(one.map((x, i) => (i ? x - one[i - 1]! : 0)), [0, 60, 60], "one offset for the whole chart: times stay in order");
});

test("an open coin page reads its chart again on the range's own cadence, at least every 30 s", () => {
  for (const [r, ms] of Object.entries(CHART_REFRESH_MS)) assert.ok(ms >= 30_000, `${r} ${ms}`);
  assert.equal(CHART_REFRESH_MS["1H"], 30_000);
  assert.ok(CHART_REFRESH_MS["1D"] <= 60_000, "a day's chart gets each new five-minute candle within a minute");
});

// Product decision, 4 Nov (a test phone, STONK on LIVE): "weird uneven and too bright grid lines on our charts". The library spaces bars
// by index, so trades at 13:38, 14:00, 14:15 and 18:57 drew as four equal steps across the hour.
test("chart bug: candles sit on an even time grid; a quiet stretch is a flat gap, not a squeezed step", async () => {
  const { onTimeGrid } = await import("./chart-math.ts");
  const m = 60_000, k = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 });
  const g = onTimeGrid([k(0, 1), k(m, 2), k(4 * m, 3)]);
  assert.deepEqual(g.map((x) => x.t / m), [0, 1, 2, 3, 4], "one slot a minute, evenly");
  assert.deepEqual(g.map((x) => x.c), [1, 2, 2, 2, 3], "a gap carries the last close: the price didn't move");
  assert.deepEqual(g.map((x) => !!x.gap), [false, false, true, true, false]);
  for (let i = 2; i < g.length; i++) assert.equal(g[i]!.t - g[i - 1]!.t, g[1]!.t - g[0]!.t, "linear in time");
  const wide = onTimeGrid([k(0, 1), k(m, 2), k(5 * 3_600_000, 3)], 60);
  assert.ok(wide.length <= 61, `capped at the slot limit: ${wide.length}`);
  assert.equal(wide.at(-1)!.c, 3, "the last price is kept");
  assert.deepEqual(onTimeGrid([k(0, 1)]).map((x) => x.c), [1], "control: one candle stays one");
});

test("chart bug: LIVE is the last hour, starting flat at the price before it (control: nothing before, nothing added)", async () => {
  const { lastHour } = await import("./chart-math.ts");
  const m = 60_000, h = 60 * m, now = 19 * h, k = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 });
  const old = [k(13 * h + 38 * m, 0.122), k(14 * h, 0.1225), k(14 * h + 15 * m, 0.123)];
  assert.deepEqual(lastHour(old, now), [{ t: 18 * h, o: 0.123, h: 0.123, l: 0.123, c: 0.123, v: 0 }], "hours-old trades: one flat start at their last price");
  const recent = [...old, k(18 * h + 30 * m, 0.125)];
  assert.deepEqual(lastHour(recent, now).map((x) => x.c), [0.123, 0.125]);
  assert.deepEqual(lastHour([k(18 * h + 10 * m, 1)], now).map((x) => x.c), [1], "control: nothing before the hour");
});
