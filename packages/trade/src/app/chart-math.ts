// The chart's arithmetic, pure: what to draw, where a finger is, the live price on the newest candle, a coin's age.
import type { Candle } from "../market/types.ts";

/** At most `max` candles to draw: neighbours merged (the first open, the last close, the high, low and volume across). */
export function fitCandles(c: Candle[], max: number): Candle[] {
  if (c.length <= max) return c;
  const per = Math.ceil(c.length / max), out: Candle[] = [];
  for (let i = 0; i < c.length; i += per) {
    const g = c.slice(i, i + per);
    out.push({ t: g[0]!.t, o: g[0]!.o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1]!.c, v: g.reduce((n, x) => n + x.v, 0) });
  }
  return out;
}

/** The candle under a finger at `x` of a chart `width` wide, with `n` candles in equal slots. */
export const indexAt = (x: number, width: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor((x / width) * n)));

/**
 * LIVE: the price as it is now joins the newest candle (its close, and its high or low if it passes them). `at`, the
 * price's time: past the newest candle's own slot (the candles' spacing), it opens a candle of its own at its slot, so
 * a page left open never paints today's price onto a candle minutes old (audit 2 Nov).
 */
export function withLive(c: Candle[], price: number | undefined, at?: number): Candle[] {
  if (!price || !(price > 0) || !c.length) return c;
  const last = c[c.length - 1]!;
  // the candles' slot: the smallest gap among the last few (a minute with no trade has no candle, so one gap can be wider)
  let step = 0;
  for (let i = Math.max(1, c.length - 10); i < c.length; i++) { const g = c[i]!.t - c[i - 1]!.t; if (g > 0 && (step === 0 || g < step)) step = g; }
  if (at !== undefined && step > 0 && at >= last.t + step) {
    const t = last.t + Math.floor((at - last.t) / step) * step;
    return [...c, { t, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 }];
  }
  return [...c.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
}

/** How often an open coin page reads its chart again, by range (each its candles' own cache time, at least 30 s): new
 *  candles join while the page stays open, and the chart is never a picture of when it was opened. */
export const CHART_REFRESH_MS: Record<"1H" | "1D" | "1W" | "1M" | "1Y" | "ALL", number> = { "1H": 30_000, "1D": 60_000, "1W": 120_000, "1M": 120_000, "1Y": 600_000, "ALL": 3_600_000 };

/** How long a coin has traded, in plain words: "5 hours", "12 days", "4 months", "2 years". */
export function ageText(ms: number): string {
  const h = ms / 3_600_000, d = h / 24;
  const n = (v: number, one: string) => { const k = Math.max(1, Math.floor(v)); return `${k} ${one}${k === 1 ? "" : "s"}`; };
  return h < 24 ? n(h, "hour") : d < 60 ? n(d, "day") : d < 730 ? n(d / 30.44, "month") : n(d / 365.25, "year");
}

/** How long ago a trade was, short: "now", "40 s", "3 min", "2 h", "5 d". */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 10 ? "now" : s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86_400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86_400)} d`;
}

/**
 * A candle's time as the chart takes it (seconds): lightweight-charts draws its axis in UTC, so the time is moved by the
 * device's own offset (today's, one for every candle: times stay in order across a summer-time change) and the axis reads
 * the person's clock, as the finger's label (toLocaleString) does.
 */
export function chartTime(ms: number, offsetMin: number = new Date().getTimezoneOffset()): number {
  return Math.floor((ms - offsetMin * 60_000) / 1000);
}

/** A slot on the chart's time grid: a real candle, or a gap where nothing traded (its price is the last close, `gap`). */
export type GridCandle = Candle & { gap?: true };

/**
 * The candles on an even time grid (product decision, 4 Nov): the chart library spaces bars by index, so
 * a coin that traded at 13:38, 14:00 and 18:57 drew those hours as equal steps. Each slot of `step` (the candles' own
 * spacing, widened so at most `maxSlots` are drawn) holds the candles that fell in it, merged; a slot where nothing traded
 * is a gap carrying the last close, so the line stays flat (the price didn't move) and candles leave it empty.
 */
export function onTimeGrid(c: readonly Candle[], maxSlots = 360): GridCandle[] {
  if (c.length < 2) return [...c];
  let minGap = 0;
  for (let i = 1; i < c.length; i++) { const g = c[i]!.t - c[i - 1]!.t; if (g > 0 && (minGap === 0 || g < minGap)) minGap = g; }
  const first = c[0]!.t, span = c[c.length - 1]!.t - first;
  if (!(minGap > 0) || !(span > 0)) return [...c];
  const step = Math.max(minGap, Math.ceil(span / maxSlots / minGap) * minGap);
  const slots = new Map<number, Candle>();
  for (const k of c) {
    const i = Math.floor((k.t - first) / step), was = slots.get(i);
    slots.set(i, was ? { t: was.t, o: was.o, h: Math.max(was.h, k.h), l: Math.min(was.l, k.l), c: k.c, v: was.v + k.v } : { ...k, t: first + i * step });
  }
  const out: GridCandle[] = [];
  const last = Math.floor(span / step);
  let close = c[0]!.o;
  for (let i = 0; i <= last; i++) {
    const k = slots.get(i);
    if (k) { out.push(k); close = k.c; } else out.push({ t: first + i * step, o: close, h: close, l: close, c: close, v: 0, gap: true });
  }
  return out;
}

/**
 * LIVE (the last hour): only the hour's candles. A coin that last traded hours ago drew its old candles across the hour
 * (13:38 stretched to 18:57, product decision, 4 Nov); now the hour starts flat at the last price before it (nothing traded since),
 * then the hour's own candles. With nothing before and nothing in the hour, nothing to draw.
 */
export function lastHour(c: readonly Candle[], now: number, spanMs = 3_600_000): Candle[] {
  const from = Math.ceil((now - spanMs) / 60_000) * 60_000;
  const inside = c.filter((k) => k.t >= from);
  const before = [...c].reverse().find((k) => k.t < from);
  if (!before) return inside;
  if (inside[0]?.t === from) return inside;
  return [{ t: from, o: before.c, h: before.c, l: before.c, c: before.c, v: 0 }, ...inside];
}

/** Bug (the chart): the header's change is the range on screen, first open to last close, so its
 *  colour is the line's (chart-style directionOf); a range with no start price has none. */
export function rangeChange(c: readonly Candle[]): { usd: number; pct: number; dir: "up" | "down" } | undefined {
  const first = c[0], last = c[c.length - 1];
  if (!first || !last || !(first.o > 0)) return undefined;
  const usd = last.c - first.o;
  return { usd, pct: (usd / first.o) * 100, dir: last.c >= first.o ? "up" : "down" };
}

/** The words after the header's change, one per range. */
export const RANGE_WORDS: Record<"1H" | "1D" | "1W" | "1M" | "1Y" | "ALL", string> = {
  "1H": "in 1 hour", "1D": "in 24 hours", "1W": "in 1 week", "1M": "in 1 month", "1Y": "in 1 year", "ALL": "all time",
};

/** The words after the header's change: the range's own, or "since it started" when the range is longer than the coin
 *  has traded and the chart is its whole life (candles.ts wholeLife; the Copywriter's line, 4 Nov). */
export function rangeWords(range: "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL", whole: boolean): string {
  return whole && range !== "1H" ? "since it started" : RANGE_WORDS[range];
}

/** The time labels under the chart: four, evenly spread from its first candle to its last, in the range's unit (a time
 *  of day for 1H and 1D, a day for 1W and 1M, a month and year past half a year). Local time, as the finger's label. */
export function timeTicks(c: readonly Candle[], range: "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL", n = 4): string[] {
  if (c.length < 2) return [];
  const a = c[0]!.t, b = c[c.length - 1]!.t, span = b - a;
  const long = span > 182 * 86_400_000;
  // the unit follows what is drawn, not the tab: a coin 18 hours old on 1Y draws its hours, so its labels are times
  const hours = range === "1H" || range === "1D" || span <= 36 * 3_600_000;
  const say = (ms: number) => {
    const d = new Date(ms);
    if (hours) return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, " ").toLowerCase();
    if (long) return `${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
  };
  return Array.from({ length: n }, (_, i) => say(a + (span * i) / (n - 1)));
}

/** The header's change for a range: 1D is the market's own 24-hour figure when there is one (the list's row says the
 *  same, grade 1 Nov), every other range the candles' own (rangeChange). The line takes the colour this says. */
export function headerMove(range: "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL", c: readonly Candle[], day?: { usd: number; pct: number }): { usd: number; pct: number; dir: "up" | "down" } | undefined {
  if (range === "1D" && day && Number.isFinite(day.pct)) return { ...day, dir: day.pct >= 0 ? "up" : "down" };
  return rangeChange(c);
}
