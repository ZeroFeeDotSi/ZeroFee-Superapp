// The chart's look, pure (3 Nov: the chart was black and white; it is red and green always, like
// TradingView): which way the shown period went, the colours that follow from it, each volume bar's colour, the candle a
// finger is on, and where the current price's tag sits on the right edge. Chart.tsx hands these to the canvas.
import type { Candle } from "../market/types.ts";

export type Direction = "up" | "down";
/** The candles' level lines, the chart's only grid (candles only; the line has none): barely there in both themes. */
export const GRID_ALPHA = 0.05;
/** The finger's line on the chart: a hairline, not a dashed cross. */
export const SCRUB_ALPHA = 0.35;
export interface ChartPalette { up: string; down: string }

/** The period's direction: its last close against its first open. Level counts as up (TradingView's own rule). */
export function directionOf(c: readonly Candle[]): Direction {
  if (!c.length) return "up";
  return c[c.length - 1]!.c >= c[0]!.o ? "up" : "down";
}

/** A colour at an opacity, as the canvas parser reads it (rgba; it reads neither color-mix nor CSS variables). */
export function alpha(color: string, a: number): string {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((x) => x + x).join("") : hex[1]!;
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`;
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})` : c;
}

/** The line's colours: green when the period rose, red when it fell, a wash of the same under it fading to nothing. */
export function lineColors(p: ChartPalette, dir: Direction): { line: string; top: string; bottom: string; tag: string } {
  const col = dir === "up" ? p.up : p.down;
  return { line: col, top: alpha(col, 0.28), bottom: alpha(col, 0), tag: col };
}

/** A candle's colour: green when it closed at or above its open, red when below. */
export const candleColor = (c: Candle, p: ChartPalette): string => (c.c >= c.o ? p.up : p.down);

/** A volume bar: its candle's colour, faint, so the bars sit under the price and never compete with it. */
export const volumeColor = (c: Candle, p: ChartPalette): string => alpha(candleColor(c, p), 0.3);

/** The candle nearest a time (seconds, as the chart gives it) under the finger; `timeOf` turns a candle into those seconds. */
export function nearestCandle(c: readonly Candle[], tSec: number, timeOf: (ms: number) => number): Candle | null {
  if (!c.length || !Number.isFinite(tSec)) return null;
  let lo = 0, hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeOf(c[mid]!.t) < tSec) lo = mid + 1; else hi = mid;
  }
  const after = c[lo]!, before = lo > 0 ? c[lo - 1]! : after;
  return Math.abs(timeOf(before.t) - tSec) <= Math.abs(timeOf(after.t) - tSec) ? before : after;
}

/**
 * A price's height on a pane `height` px tall showing prices from `min` to `max` with `top`/`bottom` margins (fractions):
 * the candle geometry's one formula, and where the current price's tag sits on the right edge.
 */
export function priceY(price: number, min: number, max: number, height: number, top = 0.08, bottom = 0.22): number {
  const span = max - min, inner = height * (1 - top - bottom);
  if (!(span > 0)) return height * top + inner / 2;
  return height * top + ((max - price) / span) * inner;
}

/** One candle's pixels: the wick from high to low, the body from open to close (at least 1 px so a flat candle shows). */
export function candleBox(k: Candle, min: number, max: number, height: number): { wickTop: number; wickBottom: number; bodyTop: number; bodyBottom: number } {
  const y = (v: number) => priceY(v, min, max, height);
  const a = y(k.o), b = y(k.c);
  const bodyTop = Math.min(a, b), bodyBottom = Math.max(Math.max(a, b), Math.min(a, b) + 1);
  return { wickTop: y(k.h), wickBottom: y(k.l), bodyTop, bodyBottom };
}

/** The same candles, by value: the coin page builds its candles afresh on every render (the live price on the last one),
 *  so the chart redraws only when a candle really changed (design session, 5 Nov: with the mouse resting on the chart,
 *  each redraw re-reported the candle under it as a new object, the page took it and rendered again: 41 "Maximum update
 *  depth exceeded" in 2 s on DOPE's page). */
export function sameCandles(a: readonly Candle[] | undefined, b: readonly Candle[]): boolean {
  if (a === b) return true;
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x !== y && (x.t !== y.t || x.o !== y.o || x.h !== y.h || x.l !== y.l || x.c !== y.c || x.v !== y.v)) return false;
  }
  return true;
}
