// 3 Nov: the chart was black and white; it is red and green always, like TradingView.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Candle } from "../market/types.ts";
import { alpha, candleBox, candleColor, directionOf, lineColors, nearestCandle, priceY, sameCandles, volumeColor } from "./chart-style.ts";

const P = { up: "#14894f", down: "#cc3a33" };
const k = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ t, o, h, l, c, v });

test("the line is green when the shown period rose and red when it fell, never black (control: level is up, as TradingView)", () => {
  const rose = [k(0, 1, 1.2, 0.9, 1.1), k(60_000, 1.1, 1.6, 1, 1.5)];
  const fell = [k(0, 1, 1.2, 0.8, 0.9), k(60_000, 0.9, 1, 0.5, 0.6)];
  assert.equal(directionOf(rose), "up");
  assert.equal(directionOf(fell), "down");
  assert.equal(directionOf([k(0, 1, 1, 1, 1)]), "up", "control: level");
  assert.equal(directionOf([]), "up");
  assert.deepEqual(lineColors(P, "up"), { line: P.up, top: "rgba(20, 137, 79, 0.28)", bottom: "rgba(20, 137, 79, 0)", tag: P.up });
  assert.equal(lineColors(P, "down").line, P.down);
  assert.notEqual(lineColors(P, "up").line, lineColors(P, "down").line, "control: the two directions differ");
  // the period's direction, not the last candle's: a period that rose overall with a red last candle is green
  assert.equal(directionOf([k(0, 1, 2, 1, 2), k(60_000, 2, 2, 1.5, 1.6)]), "up");
});

test("candles and their volume bars: green at or above the open, red below, the bars faint", () => {
  assert.equal(candleColor(k(0, 1, 2, 0.5, 1.5), P), P.up);
  assert.equal(candleColor(k(0, 1, 2, 0.5, 1), P), P.up, "a flat candle is green");
  assert.equal(candleColor(k(0, 1.5, 2, 0.5, 1), P), P.down);
  assert.equal(volumeColor(k(0, 1.5, 2, 0.5, 1), P), "rgba(204, 58, 51, 0.3)");
  assert.equal(alpha("rgb(1, 2, 3)", 0.5), "rgba(1, 2, 3, 0.5)");
  assert.equal(alpha("#abc", 1), "rgba(170, 187, 204, 1)");
});

test("candle geometry: high above low, the body between open and close, at least 1 px (control: a higher price is higher on screen)", () => {
  const h = 200, min = 1, max = 2;
  const g = candleBox(k(0, 1.2, 1.9, 1.1, 1.6), min, max, h);
  assert.ok(g.wickTop < g.bodyTop && g.bodyTop < g.bodyBottom && g.bodyBottom < g.wickBottom, JSON.stringify(g));
  assert.equal(Math.round(g.bodyTop), Math.round(priceY(1.6, min, max, h)), "a green body's top is its close");
  assert.ok(priceY(1.9, min, max, h) < priceY(1.1, min, max, h), "control: up is up");
  const flat = candleBox(k(0, 1.5, 1.5, 1.5, 1.5), min, max, h);
  assert.ok(flat.bodyBottom - flat.bodyTop >= 1, "a flat candle still shows");
  // the price scale's margins: the top 8 % clear, the bottom 22 % left for the volume bars
  assert.equal(priceY(2, min, max, h), 16);
  assert.equal(priceY(1, min, max, h), 156);
  assert.equal(priceY(5, 5, 5, h), 86, "one price: the middle of the pane");
});

test("the current price's tag sits at its price on the right edge (control: it moves with the price)", () => {
  const at = (p: number) => priceY(p, 0.001, 0.003, 220);
  assert.ok(at(0.0025) < at(0.0015));
  assert.ok(at(0.003) >= 0 && at(0.001) <= 220);
});

test("the crosshair reads the candle nearest the finger, between candles too (control: past the ends, the end candle)", () => {
  const c = [k(0, 1, 1, 1, 1), k(60_000, 2, 2, 2, 2), k(120_000, 3, 3, 3, 3)];
  const s = (ms: number) => ms / 1000;
  assert.equal(nearestCandle(c, 60, s)?.c, 2);
  assert.equal(nearestCandle(c, 70, s)?.c, 2, "nearer the second");
  assert.equal(nearestCandle(c, 100, s)?.c, 3, "nearer the third");
  assert.equal(nearestCandle(c, -500, s)?.c, 1, "control: before the first");
  assert.equal(nearestCandle(c, 9_999, s)?.c, 3, "control: after the last");
  assert.equal(nearestCandle([], 1, s), null);
});

test("the chart is red and green in both modes, from the design's own tokens; no black line", () => {
  const src = readFileSync(new URL("./Chart.tsx", import.meta.url), "utf8");
  assert.match(src, /v\("--up"/);
  assert.match(src, /v\("--down"/);
  assert.doesNotMatch(src, /lineColor: p\.ink/, "the black ink line is gone");
  assert.doesNotMatch(src, /lastValueVisible: true/, "no price tag over the axis labels: the price is the header's (chart bug)");
  assert.match(src, /HistogramSeries/, "volume bars");
  // the library loads only when a coin page opens, never in Trade's first load
  assert.match(src, /import\("lightweight-charts"\)/);
  assert.doesNotMatch(src, /^import .* from "lightweight-charts"/m);
});

// Product decision, 4 Nov (a test phone, STONK): "weird uneven and too bright grid lines on our charts; charts should be like the best
// wallets'". The grid was the text colour at 12 % in both directions, with a time axis whose first label was cut off.
test("chart bug: no vertical grid, a barely-there level grid for candles only, no clipped axis, a hairline finger", async () => {
  const src = readFileSync(new URL("./Chart.tsx", import.meta.url), "utf8");
  const { GRID_ALPHA, SCRUB_ALPHA } = await import("./chart-style.ts");
  assert.ok(GRID_ALPHA <= 0.06, `the grid is barely there: ${GRID_ALPHA}`);
  assert.ok(SCRUB_ALPHA < 0.5);
  assert.match(src, /vertLines: \{ visible: false \}/, "no vertical time grid");
  assert.match(src, /horzLines: \{ visible: !line, color: alpha\(p\.text, GRID_ALPHA\) \}/, "the line has no grid; candles a faint one");
  assert.doesNotMatch(src, /alpha\([a-z]\.text, 0\.12\)/, "the old 12 % grid is gone, recolour included");
  assert.match(src, /timeScale: \{ visible: false/, "no time axis to clip: the time shows above as the finger moves");
  assert.match(src, /entireTextOnly: true/, "a price label that doesn't fit whole isn't drawn half cut");
  assert.match(src, /setCrosshairPosition\(k\.c, sec\(k\.t\), price as never\)/, "a finger moves the line at once, no long press");
  assert.doesNotMatch(src, /priceLineVisible: true/, "no dotted price line across the chart");
  assert.match(src, /horzLine: \{ visible: false, labelVisible: false \}/, "the finger is one thin line, not a dashed cross");
  assert.match(src, /onTimeGrid\(cs\)/, "drawn on an even time grid");
  assert.match(src, /calm \? lib\.LastPriceAnimationMode\.Disabled/, "Reduce Motion: no pulse on the last point");
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<ChartMode>\("line"\)/, "the line first, candles a tap away");
  assert.match(page, /lastHour\(candles\.value, Date\.now\(\)\)/, "LIVE is the last hour");
});

test("sameCandles: a new array of the same candles is the same chart; a changed close or one more candle is not (controls)", () => {
  const a: Candle[] = [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 2, o: 1.5, h: 2, l: 1, c: 1.8, v: 4 }];
  const copy = a.map((c) => ({ ...c }));
  assert.equal(sameCandles(a, copy), true);
  assert.equal(sameCandles(a, a), true);
  assert.equal(sameCandles(undefined, a), false);
  assert.equal(sameCandles(a, [a[0]!, { ...a[1]!, c: 1.81 }]), false, "a live tick on the last candle redraws");
  assert.equal(sameCandles(a, [a[0]!, { ...a[1]!, v: 5 }]), false);
  assert.equal(sameCandles(a, [...copy, { t: 3, o: 1.8, h: 1.8, l: 1.8, c: 1.8, v: 0 }]), false, "a new candle redraws");
  assert.equal(sameCandles(a, a.slice(1)), false);
});
