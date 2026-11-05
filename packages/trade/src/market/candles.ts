// OHLCV history from GeckoTerminal for the coin's main pool (display only), in USD, ascending, t in ms.
// Six ranges, five calls: 1W and 1M share one hourly call (a call is cached by its path), and a call costs one of the minute's budget only when its cache is cold.
import type { ChainId } from "../types.ts";
import { GT_NETWORK, MarketError, type GtClient, type Priority } from "./gt.ts";
import type { Candle, Range } from "./types.ts";

export interface Timeframe { tf: "minute" | "hour" | "day"; aggregate: number; limit: number; ttlMs: number }
export interface Plan { fetch: Timeframe; take: number; groupHours?: number }
const MIN1: Timeframe = { tf: "minute", aggregate: 1, limit: 60, ttlMs: 20_000 };
const MIN5: Timeframe = { tf: "minute", aggregate: 5, limit: 288, ttlMs: 30_000 };
const HOURLY: Timeframe = { tf: "hour", aggregate: 1, limit: 720, ttlMs: 120_000 };
const DAILY: Timeframe = { tf: "day", aggregate: 1, limit: 365, ttlMs: 600_000 };
const DAILY_ALL: Timeframe = { tf: "day", aggregate: 1, limit: 1000, ttlMs: 3_600_000 };   // the most GeckoTerminal gives
export const PLAN: Record<Range, Plan> = {
  "1H": { fetch: MIN1, take: 60 },                       // 60 one-minute candles
  "1D": { fetch: MIN5, take: 288 },                      // 288 five-minute candles
  "1W": { fetch: HOURLY, take: 168 },                    // the last 168 hours
  "1M": { fetch: HOURLY, take: 720, groupHours: 2 },     // 30 days in 2-hour candles (360)
  "1Y": { fetch: DAILY, take: 365 },
  "ALL": { fetch: DAILY_ALL, take: 1000 },               // every day it has traded, up to 1000
};
/** Fifteen-minute candles: a coin one to three and a half days old, drawn on a range longer than its life. */
const MIN15: Timeframe = { tf: "minute", aggregate: 15, limit: 336, ttlMs: 60_000 };
/** How long each range is. */
export const RANGE_SPAN_MS: Record<Range, number> = { "1H": 3_600_000, "1D": 86_400_000, "1W": 7 * 86_400_000, "1M": 30 * 86_400_000, "1Y": 365 * 86_400_000, "ALL": Infinity };
/** A coin's whole life, by how old it is: the finest candles that still reach back to its start (bug report, 4 Nov: a coin
 *  18 hours old drew 1Y as two daily candles, 1M as eleven, 1W as twenty: checked on GeckoTerminal's own answer). Up to a
 *  day: five-minute candles; 3.5 days: fifteen-minute; a week: hourly; a month: two-hourly. */
const LIFE: [number, Plan][] = [[24, PLAN["1D"]], [84, { fetch: MIN15, take: 336 }], [168, PLAN["1W"]], [720, PLAN["1M"]]];
/**
 * What to ask for `range` of a coin `ageMs` old. A range longer than the coin's life draws the life itself at the finest
 * candles that cover it; LIVE (1H) and a coin whose age isn't known keep the range's own candles.
 */
export function planFor(range: Range, ageMs?: number): Plan {
  return wholeLife(range, ageMs) ? LIFE.find(([h]) => ageMs! <= h * 3_600_000)?.[1] ?? PLAN[range] : PLAN[range];
}
/** The range on screen is longer than the coin has traded: the chart is its whole life ("since it started"). */
export const wholeLife = (range: Range, ageMs?: number): boolean => range !== "1H" && ageMs !== undefined && ageMs >= 0 && ageMs < RANGE_SPAN_MS[range];

/** Groups ascending candles into buckets of `hours` aligned to UTC. */
export function groupCandles(c: Candle[], hours: number): Candle[] {
  const step = hours * 3600_000, out: Candle[] = [];
  for (const x of c) {
    const t = Math.floor(x.t / step) * step, last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; last.v += x.v; } else out.push({ ...x, t });
  }
  return out;
}

export function parseOhlcv(j: unknown): Candle[] {
  const list = (j as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) throw new MarketError("bad_response", "no candles in the answer");
  // GeckoTerminal answers newest first. One time can come twice (NEAR's pools, 2 Nov 2026: two rows per minute, a block
  // each): they are one candle, the newer row's close and the older row's open, so the chart's times only ever rise
  const byT = new Map<number, Candle>();
  for (const r of list as number[][]) {
    const [ts, o, h, l, c, v] = r as [number, number, number, number, number, number];
    if (![ts, o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x)) || !(c > 0)) continue;
    const t = ts * 1000, vol = Number.isFinite(v) ? v : 0, had = byT.get(t);
    if (had) Object.assign(had, { o, h: Math.max(had.h, h), l: Math.min(had.l, l), v: had.v + vol });
    else byT.set(t, { t, o, h, l, c, v: vol });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function ohlcvPath(chain: ChainId, pool: string, address: string, range: Range, ageMs?: number): { path: string; ttlMs: number } {
  const t = planFor(range, ageMs).fetch;
  // minutes and hours with no trade come as flat candles (include_empty_intervals), so 288 five-minute candles are the
  // last 24 hours: without them a quiet pool's "1D" ran back 44 hours and LIVE's 60 minutes 4.5 hours (audit 2 Nov)
  const empty = t.tf === "day" ? "" : "&include_empty_intervals=true";
  return { path: `networks/${GT_NETWORK[chain]}/pools/${pool}/ohlcv/${t.tf}?aggregate=${t.aggregate}&limit=${t.limit}&currency=usd${empty}&token=${encodeURIComponent(address)}`, ttlMs: t.ttlMs };
}

/** `ageMs`: how long the coin has traded (planFor). `prio` "low": a warm-up the screen didn't ask for (never waits). */
export async function history(gt: GtClient, chain: ChainId, address: string, pool: string, range: Range, waitMs?: number, ageMs?: number, prio: Priority = "high"): Promise<Candle[]> {
  if (!PLAN[range]) throw new MarketError("unsupported", `unknown range ${String(range)}`);
  const plan = planFor(range, ageMs);
  const { path, ttlMs } = ohlcvPath(chain, pool, address, range, ageMs);
  const out = parseOhlcv(await gt.get(path, ttlMs, prio, prio === "high" ? { waitMs } : {}));
  const grouped = plan.groupHours ? groupCandles(out, plan.groupHours) : out;
  return grouped.slice(-(plan.groupHours ? Math.ceil(plan.take / plan.groupHours) : plan.take));
}

/** How far the price moved in the last minute or two, in bps of the mid, from the latest one-minute candles; undefined when there are fewer than one. */
export function moveBpsOfMinutes(c: Candle[]): number | undefined {
  const last = c.slice(-2);
  if (!last.length) return undefined;
  const hi = Math.max(...last.map((x) => x.h)), lo = Math.min(...last.map((x) => x.l));
  const mid = (hi + lo) / 2;
  return mid > 0 ? Math.round(((hi - lo) / mid) * 10_000) : undefined;
}
