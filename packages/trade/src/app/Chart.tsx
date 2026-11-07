// The coin's chart: TradingView's own lightweight-charts, loaded only when a coin page opens (never in Trade's first load).
// Product decision, 4 Nov ("weird uneven and too bright grid lines; charts should be like the best wallets'"): the line is the chart.
// No grid, no axes, no tag: one line, green when the shown period rose and red when it fell (the design's --up / --down,
// both themes), a soft wash fading under it, on an even time grid (chart-math onTimeGrid). A finger on it shows a thin
// line and a dot, and the price and time above take that moment's (onScrub); letting go returns them to now. Candles,
// a tap away, keep a price scale and a barely-there level grid, nothing more (no price tag on the scale: it covered a
// label, and the price is the header's). A live tick changes only the last point.
import { useEffect, useRef, useState } from "react";
import type { Candle } from "../market/types.ts";
import { chartTime, onTimeGrid, type GridCandle } from "./chart-math.ts";
import { alpha, directionOf, GRID_ALPHA, lineColors, nearestCandle, sameCandles, SCRUB_ALPHA, volumeColor, type Direction } from "./chart-style.ts";
import { price as fmtPrice } from "./format.ts";
import { armScrub, type ScrubArm } from "./coin-words.ts";

export type ChartMode = "line" | "candle";
type Lib = typeof import("lightweight-charts");
/** The chart library, once loaded: kept for the page's life, so a second coin's chart draws in its first frame (D145). */
let libLoaded: Lib | undefined;
let libLoading: Promise<Lib> | undefined;
const loadLib = (): Promise<Lib> => (libLoading ??= import("lightweight-charts").then((m) => (libLoaded = m)));
type Api = ReturnType<Lib["createChart"]>;
type Series = { setData(d: unknown[]): void; update(p: unknown): void; applyOptions(o: unknown): void };

/** The theme's colours, read off the page (the canvas can't read CSS variables itself). */
function palette(el: HTMLElement) {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const glow = v("--glow-rgb", "11, 11, 12");
  return {
    up: v("--up", "") || v("--tr-up", "#14894f"), down: v("--down", "") || v("--tr-down", "#cc3a33"), text: v("--mute", "#8a8f98"), grid: v("--line", "rgba(127,127,127,.15)"), hair: v("--hair", "rgba(127,127,127,.4)"),
    ink: v("--ink", "#0b0b0c"), bg: v("--bg", "#ffffff"),
    // the line's light: the theme's glow colour, a soft wash fading to nothing
    glowTop: `rgba(${glow}, 0.12)`, glowBottom: `rgba(${glow}, 0)`,
  };
}
/** The chart draws its axis in UTC: each candle is given at its time on the device's clock (chart-math.ts chartTime), so
 *  the axis and the finger's label read the person's own time (audit 2 Nov: "18:05" on the axis at 03:05 on a phone in another time zone). */
const sec = (ms: number) => chartTime(ms) as never;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A price label: its own four significant figures, trailing zeros trimmed ("0.03", "0.000005733"), never "e-6". */
/** A price is never below zero: the scale's autoscale stops at 0 (the volume strip's margin had pushed it negative). */
const floorAtZero = (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
  const r = orig();
  if (r?.priceRange) r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
  return r;
};
export function priceLabel(p: number): string {
  if (!Number.isFinite(p) || p < 0) return "";                         // the volume strip's room below zero has no price
  return p.toFixed(decimalsFor(Math.abs(p))).replace(/\.?0+$/, "");
}
/** The price scale's decimals for a coin's price: four significant figures, so a memecoin at $0.0000057 reads as one. */
export function decimalsFor(price: number): number {
  if (!(price > 0)) return 2;
  return Math.min(12, Math.max(2, Math.ceil(-Math.log10(price)) + 3));
}
/** `dir`: the colour the page says the range went (its header's change); the candles' own when not given. */
export function Chart({ candles, mode = "line", dir: dirIn, height = 220, onScrub }: { candles: Candle[]; mode?: ChartMode; dir?: Direction | undefined; height?: number; onScrub?: (c: Candle | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [lib, setLib] = useState<Lib | undefined>(() => libLoaded);
  const s = useRef<{ chart?: Api; price?: Series; vol?: Series; first?: number; n?: number; mode?: ChartMode; dir?: Direction; grid?: GridCandle[] }>({});
  const scrub = useRef(onScrub);
  scrub.current = onScrub;
  /** What the pointer last said: the library reports it after every draw, and the page hears "nothing under it" once. */
  const said = useRef<Candle | null>(null);
  const say = (k: Candle | null) => { if (k === null && said.current === null) return; said.current = k; scrub.current?.(k); };
  /** The candles and colour last drawn (by value): a new array of the same candles is not a redraw. */
  const drawnFrom = useRef<{ c?: Candle[]; dir?: Direction | undefined }>({});
  const data = useRef(candles);
  data.current = candles;
  const dirWanted = useRef(dirIn);
  dirWanted.current = dirIn;
  const dirOf = () => dirWanted.current ?? directionOf(data.current);

  useEffect(() => { if (libLoaded) return; let dead = false; void loadLib().then((m) => { if (!dead) setLib(m); }, () => { libLoading = undefined; }); return () => { dead = true; }; }, []);

  // the chart itself, once per mode (a line and candles are different series)
  useEffect(() => {
    if (!lib || !host.current) return;
    const el = host.current, p = palette(el);
    const line = mode === "line";
    const calm = reducedMotion();
    const chart = lib.createChart(el, {
      height, autoSize: true,
      layout: { background: { type: lib.ColorType.Solid, color: "transparent" }, textColor: p.text, fontFamily: "inherit", fontSize: 11, attributionLogo: false },  // no logo link on the chart: TradingView's notice is in
      grid: { vertLines: { visible: false }, horzLines: { visible: !line, color: alpha(p.text, GRID_ALPHA) } },
      rightPriceScale: { visible: !line, borderVisible: false, entireTextOnly: true, scaleMargins: line ? { top: 0.12, bottom: 0.06 } : { top: 0.08, bottom: 0.22 } },
      timeScale: { visible: false, borderVisible: false, rightOffset: line ? 0 : 2, fixLeftEdge: true, fixRightEdge: true },
      // no cursor until a finger (armScrub): the tap that opened the page leaves no line at mid-chart (copy review, 6 Nov, item 10)
      crosshair: { mode: lib.CrosshairMode.Magnet, vertLine: { visible: false, color: alpha(p.text, SCRUB_ALPHA), width: 1, style: lib.LineStyle.Solid, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      handleScroll: { vertTouchDrag: false, horzTouchDrag: false, mouseWheel: false, pressedMouseMove: false }, handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
      localization: { priceFormatter: priceLabel },
    });
    const dir = dirOf();
    const lc = lineColors(p, dir);
    const dp = decimalsFor(data.current.at(-1)?.c ?? 0);
    const priceFormat = { type: "price" as const, precision: dp, minMove: 10 ** -dp };
    const price = (line
      ? chart.addSeries(lib.AreaSeries, { lineColor: lc.line, topColor: lc.top, bottomColor: lc.bottom, lineWidth: 2, lineType: lib.LineType.Simple, priceLineVisible: false, lastValueVisible: false, lastPriceAnimation: calm ? lib.LastPriceAnimationMode.Disabled : lib.LastPriceAnimationMode.OnDataUpdate, crosshairMarkerVisible: false, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: p.bg, crosshairMarkerBackgroundColor: lc.line, priceFormat, autoscaleInfoProvider: floorAtZero })
      : chart.addSeries(lib.CandlestickSeries, { upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down, borderVisible: false, priceLineVisible: false, lastValueVisible: false, priceFormat, autoscaleInfoProvider: floorAtZero })) as unknown as Series;
    // candles only: the volume as faint bars underneath; the line stands alone
    const vol = line ? undefined : chart.addSeries(lib.HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }) as unknown as Series;
    if (!line) chart.priceScale("").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    let arm: ScrubArm = { armed: false };
    const armWith = (e: PointerEvent, type: "down" | "move") => {
      if (arm.armed) return;
      arm = armScrub(arm, { type, x: e.clientX, y: e.clientY });
      if (!arm.armed) return;
      chart.applyOptions({ crosshair: { vertLine: { visible: true } } });
      if (line) price.applyOptions({ crosshairMarkerVisible: true });
    };
    chart.subscribeCrosshairMove((e) => {
      if (!arm.armed || !e.time || !e.point) { say(null); return; }
      say(nearestCandle(s.current.grid ?? data.current, Number(e.time), (ms) => chartTime(ms)));
    });
    s.current = { chart, price, vol, mode, dir };
    // the theme changed (the system's, or the app's own switch): the same chart in the new colours
    const recolour = () => {
      const q = palette(el), c = lineColors(q, s.current.dir ?? "up");
      chart.applyOptions({ layout: { textColor: q.text }, grid: { horzLines: { color: alpha(q.text, GRID_ALPHA) } }, crosshair: { vertLine: { color: alpha(q.text, SCRUB_ALPHA) } } });
      if (line) price.applyOptions({ lineColor: c.line, topColor: c.top, bottomColor: c.bottom, crosshairMarkerBorderColor: q.bg, crosshairMarkerBackgroundColor: c.line });
      else price.applyOptions({ upColor: q.up, downColor: q.down, wickUpColor: q.up, wickDownColor: q.down });
      draw(true);
    };
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", recolour);
    const mo = new MutationObserver(recolour);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    // a finger down and moving: the thin line and its dot follow it at once (no long press), and the price and time above
    // take that moment's; lifted, gone or cancelled: they go back to now (design review 18: the scrub's date stayed)
    const follow = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.type === "pointerdown") return;   // a mouse hovers: the library's own crosshair
      const grid = s.current.grid;
      if (!grid?.length) return;
      const t = chart.timeScale().coordinateToTime(e.clientX - el.getBoundingClientRect().left);
      if (t === null) return;
      const k = nearestCandle(grid, Number(t), (ms) => chartTime(ms));
      if (!k) return;
      chart.setCrosshairPosition(k.c, sec(k.t), price as never);
      say(k);
    };
    const down = (e: PointerEvent) => { armWith(e, "down"); if (e.pointerType !== "mouse") { held = true; follow(e); } };
    const move = (e: PointerEvent) => { armWith(e, "move"); if (held) follow(e); };
    let held = false;
    const unscrub = () => { held = false; chart.clearCrosshairPosition(); say(null); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    const ends = ["pointerup", "pointerleave", "pointercancel", "touchend"] as const;
    for (const ev of ends) el.addEventListener(ev, unscrub);
    draw(true);
    return () => { mq.removeEventListener("change", recolour); mo.disconnect(); el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); for (const ev of ends) el.removeEventListener(ev, unscrub); chart.remove(); s.current = {}; };
  }, [lib, mode, height]);

  // new candles: a live tick changes only the last one in place; a new range (or more candles) draws them all. The same
  // candles in a new array (the page's every render) draw nothing.
  useEffect(() => {
    const was = drawnFrom.current;
    if (was.c && was.dir === dirIn && sameCandles(was.c, candles)) return;
    drawnFrom.current = { c: candles, dir: dirIn };
    draw(false);
  }, [candles, dirIn]);

  function draw(all: boolean) {
    const { chart, price, vol, first, n } = s.current;
    if (!chart || !price || !host.current || !data.current.length) return;
    const cs = data.current, p = palette(host.current);
    // an even time grid: a quiet stretch is a flat line (the price didn't move) or an empty slot between candles
    const grid = onTimeGrid(cs);
    s.current.grid = grid;
    const point = (c: GridCandle) => (s.current.mode === "line" ? { time: sec(c.t), value: c.c } : c.gap ? { time: sec(c.t) } : { time: sec(c.t), open: c.o, high: c.h, low: c.l, close: c.c });
    const bar = (c: GridCandle) => (c.gap ? { time: sec(c.t) } : { time: sec(c.t), value: c.v, color: volumeColor(c, p) });
    // the period's direction can turn with a live tick: the line and its tag follow it, green or red
    const dir = dirOf();
    if (s.current.mode === "line" && dir !== s.current.dir) {
      const c = lineColors(p, dir);
      price.applyOptions({ lineColor: c.line, topColor: c.top, bottomColor: c.bottom, crosshairMarkerBackgroundColor: c.line });
    }
    s.current.dir = dir;
    if (!all && first === grid[0]!.t && n === grid.length) {
      price.update(point(grid[grid.length - 1]!));
      vol?.update(bar(grid[grid.length - 1]!));
      return;
    }
    const dp = decimalsFor(cs[cs.length - 1]!.c);
    price.applyOptions({ priceFormat: { type: "price", precision: dp, minMove: 10 ** -dp } });
    price.setData(grid.map(point));
    vol?.setData(grid.map(bar));
    chart.timeScale().fitContent();
    s.current.first = grid[0]!.t; s.current.n = grid.length;
  }

  return <div ref={host} className="tr-chart" style={{ height, touchAction: "pan-y" }} role="img" aria-label={candles.length ? `Price from ${fmtPrice(candles[0]!.c)} to ${fmtPrice(candles[candles.length - 1]!.c)}` : "Price chart"} />;
}
