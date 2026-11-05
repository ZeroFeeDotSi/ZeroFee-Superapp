// Bug report, 4 Nov ("charts are wrong ... accurate for all time frames ... made impossible to break"): each range's exact
// GeckoTerminal request (timeframe, aggregate, limit, empty intervals), how its answer becomes candles, and what a coin
// younger than the range draws. Checked live against GeckoTerminal's own answers on 4 Nov (BONK, CAKE, an 18-hour-old
// pump.fun coin): the old plan drew that coin's 1Y as 2 daily candles, 1M as 11 and 1W as 20.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupCandles, history, ohlcvPath, parseOhlcv, planFor, PLAN, RANGE_SPAN_MS, wholeLife } from "./candles.ts";
import type { GtClient } from "./gt.ts";
import type { Range } from "./types.ts";

const POOL = "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9", COIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const H = 3_600_000, D = 24 * H;
const q = (path: string) => { const u = new URL(`https://x/${path}`); return { tf: u.pathname.split("/").at(-1), ...Object.fromEntries(u.searchParams) }; };

test("each range asks for exactly its own candles (an old coin): timeframe, aggregate, limit, empty intervals, the coin's side", () => {
  const want: Record<Range, [string, string, string, boolean]> = {
    "1H": ["minute", "1", "60", true],     // 60 one-minute candles
    "1D": ["minute", "5", "288", true],    // 288 five-minute candles: 24 hours
    "1W": ["hour", "1", "720", true],      // the last 168 of 720 hours (the call 1M shares)
    "1M": ["hour", "1", "720", true],      // 720 hours in 2-hour candles
    "1Y": ["day", "1", "365", false],      // days that traded, never padded back
    "ALL": ["day", "1", "1000", false],    // GeckoTerminal's most
  };
  for (const [range, [tf, aggregate, limit, empty]] of Object.entries(want) as [Range, typeof want[Range]][]) {
    const a = q(ohlcvPath("sol", POOL, COIN, range).path);
    assert.deepEqual([a.tf, a.aggregate, a.limit, a.currency, a.token, a.include_empty_intervals === "true"], [tf, aggregate, limit, "usd", COIN, empty], range);
    assert.ok(ohlcvPath("sol", POOL, COIN, range).path.startsWith(`networks/solana/pools/${POOL}/ohlcv/`), range);
    assert.deepEqual(q(ohlcvPath("sol", POOL, COIN, range, 5 * 365 * D).path), a, `${range}: a five-year-old coin is an old coin`);
  }
  assert.ok(ohlcvPath("bsc", "0x" + "a".repeat(40), "0x" + "b".repeat(40), "1D").path.startsWith("networks/bsc/pools/"));
  assert.deepEqual(Object.keys(PLAN).sort(), ["1D", "1H", "1M", "1W", "1Y", "ALL"]);
});

test("a range longer than the coin's life draws the life in fine candles; LIVE and an unknown age keep the range's own", () => {
  const tf = (r: Range, age?: number) => { const a = q(ohlcvPath("sol", POOL, COIN, r, age).path); return `${a.tf}/${a.aggregate}/${a.limit}`; };
  // 18 hours old (the coin of 4 Nov): every range past a day is its five-minute day
  for (const r of ["1D", "1W", "1M", "1Y", "ALL"] as const) assert.equal(tf(r, 18 * H), "minute/5/288", r);
  // two days old: fifteen-minute candles reach back 3.5 days
  for (const r of ["1W", "1M", "1Y", "ALL"] as const) assert.equal(tf(r, 2 * D), "minute/15/336", r);
  // five days: hourly; twenty days: the month's hours
  for (const r of ["1M", "1Y", "ALL"] as const) assert.equal(tf(r, 5 * D), "hour/1/720", r);
  assert.equal(planFor("1Y", 20 * D), PLAN["1M"]);
  assert.equal(planFor("ALL", 200 * D), PLAN.ALL, "200 days: every day it traded");
  assert.equal(planFor("1Y", 200 * D), PLAN["1Y"]);
  // controls
  assert.equal(tf("1H", 10 * 60_000), "minute/1/60", "LIVE is always the last hour");
  assert.equal(planFor("1W", undefined), PLAN["1W"], "age unknown: the range's own");
  assert.equal(planFor("1W", 8 * D), PLAN["1W"], "older than the range: the range's own");
  assert.equal(planFor("1W", -5), PLAN["1W"], "a clock gone wrong: the range's own");
  assert.equal(wholeLife("1Y", 18 * H), true);
  assert.equal(wholeLife("1Y", 400 * D), false);
  assert.equal(wholeLife("1H", 5 * 60_000), false);
  assert.equal(wholeLife("ALL", 5 * 365 * D), true, "ALL is always its whole life");
  assert.equal(RANGE_SPAN_MS.ALL, Infinity);
});

test("GeckoTerminal's answer becomes candles: seconds to ms, newest first to oldest first, one candle per time, bad rows out", () => {
  const t0 = 1_762_272_000; // a UTC midnight, in seconds
  const c = parseOhlcv({ data: { attributes: { ohlcv_list: [
    [t0 + 120, 4, 6, 3, 5, 10],
    [t0 + 60, 3, 4, 2, 4, 20],
    [t0 + 60, 2.5, 3.5, 2, 3, 5],         // NEAR: the same minute twice (an older block): one candle, the older open
    [t0, 1, 2, 0.5, 2.5, 30],
    [t0 - 60, 1, 1, 1, 0, 1],             // a zero close is no price
    [t0 - 120, "x", 1, 1, 1, 1],          // not a number
  ] } } });
  assert.deepEqual(c, [
    { t: t0 * 1000, o: 1, h: 2, l: 0.5, c: 2.5, v: 30 },
    { t: (t0 + 60) * 1000, o: 2.5, h: 4, l: 2, c: 4, v: 25 },
    { t: (t0 + 120) * 1000, o: 4, h: 6, l: 3, c: 5, v: 10 },
  ]);
  assert.throws(() => parseOhlcv({ data: {} }), /no candles/);
  // 2-hour candles start on the UTC even hours: first open, last close, the high, low and volume across
  const hours = [0, 1, 2, 3].map((i) => ({ t: t0 * 1000 + i * H, o: i + 1, h: i + 2, l: i, c: i + 1.5, v: 1 }));
  assert.deepEqual(groupCandles(hours, 2), [
    { t: t0 * 1000, o: 1, h: 3, l: 0, c: 2.5, v: 2 },
    { t: t0 * 1000 + 2 * H, o: 3, h: 5, l: 2, c: 4.5, v: 2 },
  ]);
});

test("history: one call per range on the screen's lane (a warm-up on the background one), each range cut to its own length", async () => {
  const asked: { path: string; prio?: string; waitMs?: number }[] = [];
  const rows = (n: number, stepS: number) => Array.from({ length: n }, (_, i) => [1_762_272_000 + (n - 1 - i) * stepS, 1, 1, 1, 1, 1]);
  const gt = { get: async (path: string, _ttl: number, prio?: string, o?: { waitMs?: number }) => { asked.push({ path, prio, waitMs: o?.waitMs }); const a = q(path); return { data: { attributes: { ohlcv_list: rows(Number(a.limit), a.tf === "day" ? 86_400 : a.tf === "hour" ? 3600 : 60 * Number(a.aggregate)) } } }; } } as unknown as GtClient;
  const len: Record<Range, number> = { "1H": 60, "1D": 288, "1W": 168, "1M": 360, "1Y": 365, "ALL": 1000 };
  for (const r of Object.keys(len) as Range[]) assert.equal((await history(gt, "sol", COIN, POOL, r, 5_000)).length, len[r], r);
  assert.ok(asked.every((a) => a.prio === "high" && a.waitMs === 5_000));
  asked.length = 0;
  await history(gt, "sol", COIN, POOL, "1W", 5_000, undefined, "low");
  assert.deepEqual(asked.map((a) => [a.prio, a.waitMs]), [["low", undefined]], "a warm-up never waits for room");
  // an 18-hour-old coin on 1Y: its five-minute candles, not two days
  const young = await history(gt, "sol", COIN, POOL, "1Y", 0, 18 * H);
  assert.equal(young.length, 288);
});
