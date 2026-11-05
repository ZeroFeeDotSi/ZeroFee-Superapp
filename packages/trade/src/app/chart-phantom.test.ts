// Bug (the chart), QA's re-test of 9e8ff98c (sim-chart, DOPE): the coin's icon behind the
// chart; the header's change follows the range (its words and colour, the chart's own); the frame never jumps on a range
// tap; the candles' price tag never covers an axis label; time labels under the chart; 1Y and ALL differ when the data does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Candle } from "../market/types.ts";

const k = (t: number, o: number, c: number): Candle => ({ t, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 });
const page = () => readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
const css = () => readFileSync(new URL("./coinpage.css", import.meta.url), "utf8");
const chart = () => readFileSync(new URL("./Chart.tsx", import.meta.url), "utf8");

test("the header's change is the range's own: first open to last close, coloured as the chart is (control: a fall is red)", async () => {
  const { rangeChange } = await import("./chart-math.ts");
  const { directionOf } = await import("./chart-style.ts");
  const up = [k(0, 2, 2.2), k(60_000, 2.2, 2.5)];
  assert.deepEqual(rangeChange(up), { usd: 0.5, pct: 25, dir: "up" });
  const down = [k(0, 2, 1.8), k(60_000, 1.8, 1.5)];
  assert.deepEqual(rangeChange(down), { usd: -0.5, pct: -25, dir: "down" });
  assert.equal(rangeChange(down)!.dir, directionOf(down), "the header and the line never disagree");
  assert.equal(rangeChange([]), undefined);
  assert.equal(rangeChange([k(0, 0, 1)]), undefined, "no start price, no percent");
});

test("1D says the market's own 24-hour change, as the list's row does (grade 1 Nov: list and page never disagree); the line takes its colour", async () => {
  const { headerMove } = await import("./chart-math.ts");
  const c = [k(0, 2, 1.9), k(60_000, 1.9, 1.95)];
  assert.deepEqual(headerMove("1D", c, { usd: 0.1, pct: 5.9 }), { usd: 0.1, pct: 5.9, dir: "up" }, "the 24 h figure, up though the candles fell");
  assert.equal(headerMove("1H", c, { usd: 0.1, pct: 5.9 })!.dir, "down", "control: other ranges are the candles'");
  assert.equal(headerMove("1D", c)!.dir, "down", "control: no 24 h figure, the candles'");
  const p = page();
  assert.match(p, /const moved = headerMove\(range, shown \?\? \[\], dayMove\)/);
  assert.match(p, /<Chart candles=\{drawn\} mode=\{mode\} dir=\{moved\?\.dir\}/, "the line's colour is the header's");
  assert.match(chart(), /const dirOf = \(\) => dirWanted\.current \?\? directionOf\(data\.current\)/);
  assert.match(p, /className=\{`cp-ticks\$\{mode === "candle" \? " cp-ticks--candle" : ""\}`\}/, "candles' labels stop at the price scale");
  assert.match(css(), /\.cp \.cp-ticks--candle \{ padding-right: 64px; \}/);
});

test("the header says which range it is (1H, 1D, 1W …), never '24 hours' on every range", async () => {
  const { RANGE_WORDS } = await import("./chart-math.ts");
  assert.deepEqual(Object.keys(RANGE_WORDS).sort(), ["1D", "1H", "1M", "1W", "1Y", "ALL"]);
  assert.equal(new Set(Object.values(RANGE_WORDS)).size, 6, "six ranges, six words");
  const p = page();
    assert.match(p, /className=\{`cp-move cp-move--\$\{moved\.dir\}`\}/, "the figure in the range's colour");
  assert.match(p, /\{rangeWords\(range, whole\)\}/);
  const { rangeWords } = await import("./chart-math.ts");
  assert.equal(rangeWords("1Y", false), "in 1 year");
  assert.equal(rangeWords("1Y", true), "since it started", "a coin younger than the range: its whole life");
  assert.equal(rangeWords("1H", true), "in 1 hour", "LIVE is always the last hour");
  assert.doesNotMatch(p, /<span className="tr-mute">in 24 hours<\/span>/, "control: the fixed 24-hour words are gone");
  assert.match(css(), /\.cp-move--up \{ color: var\(--up\); \}/);
  assert.match(css(), /\.cp-move--down \{ color: var\(--down\); \}/);
});

test("the frame stays put on a range tap: the last chart stays drawn until the next one comes, the box has one height, no scroll anchoring", () => {
  const p = page();
  assert.match(p, /const drawn = shown \?\? \(candles\.error \? undefined : kept\.current\[`\$\{coinKey\}:\$\{range\}`\] \?\? kept\.current\[coinKey\]\)/, "no loader swapped in between ranges");
  // bug report, 4 Nov (charts wrong): another range's chart is never labelled as this one: faded, no time labels, no change
  assert.match(p, /cp-chart--wait/);
  assert.match(p, /timeTicks\(waiting \? \[\] : drawn, range\)/);
  assert.match(p, /<Chart candles=\{drawn\} /);
  const c = css();
  assert.match(c, /\.cp \{ overflow-anchor: none; \}/);
  assert.match(c, /\.cp \.cp-chart \{[^}]*height: 248px;/, "the chart and its time labels, one fixed height");
  assert.match(c, /\.cp \.tr-change \{[^}]*min-height: 20px;/, "the change line keeps its height while a range loads");
});

test("the coin's icon sits behind the chart, line and candles alike, faint, never caught by a finger", () => {
  const p = page();
  assert.match(p, /<img className="cp-chart-mark" src=\{logo\} alt="" aria-hidden="true" \/>/);
  const c = css();
  assert.match(c, /\.cp \.cp-chart-mark \{[^}]*pointer-events: none;[^}]*opacity: \.07;/);
  assert.match(c, /:root\[data-theme="dark"\] \.cp \.cp-chart-mark \{ opacity: \.04; \}/, "a16: at .1 it read as a watermark");
  assert.match(c, /\.cp \.cp-chart \.tr-chart \{ position: relative; z-index: 1; \}/, "the candles drawn over it");
});

test("candles: no price tag over the axis labels; the price is the header's (control: volume bars stay)", () => {
  const src = chart();
  assert.match(src, /CandlestickSeries, \{[^}]*lastValueVisible: false/);
  assert.doesNotMatch(src, /lastValueVisible: true/);
  assert.match(src, /HistogramSeries/);
});

test("time labels under the chart, four, evenly spread, in the range's own unit; 1Y and ALL differ when the coin is older than a year", async () => {
  const { timeTicks } = await import("./chart-math.ts");
  const H = 3_600_000, D = 24 * H, t0 = Date.UTC(2026, 10, 4, 8, 0);
  const hour = Array.from({ length: 61 }, (_, i) => k(t0 + i * 60_000, 1, 1));
  const ticks = timeTicks(hour, "1H");
  assert.equal(ticks.length, 4);
  for (const s of ticks) assert.match(s, /^\d{1,2}:\d{2} (am|pm)$/, s);
  const month = Array.from({ length: 31 }, (_, i) => k(t0 - (30 - i) * D, 1, 1));
  for (const s of timeTicks(month, "1M")) assert.match(s, /^\d{1,2} [A-Z][a-z]{2}$/, s);
  const twoYears = Array.from({ length: 730 }, (_, i) => k(t0 - (729 - i) * D, 1, 1));
  const year = twoYears.slice(-365);
  assert.notDeepEqual(timeTicks(twoYears, "ALL"), timeTicks(year, "1Y"), "a coin older than a year: ALL starts earlier");
  for (const s of timeTicks(twoYears, "ALL")) assert.match(s, /^[A-Z][a-z]{2} \d{4}$/, s);
  assert.deepEqual(timeTicks([], "1D"), []);
  const { PLAN } = await import("../market/candles.ts");
  assert.ok(PLAN.ALL.take > PLAN["1Y"].take && PLAN.ALL.fetch.limit > PLAN["1Y"].fetch.limit, "ALL reads further back than 1Y");
  const p = page();
  assert.match(p, /aria-hidden="true">\{timeTicks\(waiting \? \[\] : drawn, range\)\.map/);
  assert.match(css(), /\.cp \.cp-ticks \{[^}]*justify-content: space-between;/);
});
