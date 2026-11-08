// the copy review's items 9 and 10 (6 Nov; fix/trade-list-coin, 7 Nov): Trade's list and coin page words, a table per choice, and the
// screens wired to them. Each table's last rows are the shot's own figures (DOPE: +5.9% list, +5.0% pool, −$0.11 −0.4%).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armScrub, dayChangePct, dayTime, headerChange, holdingChange, moveFigures, moveUsd, priceWord, rowLines, STAT_LABELS, walletChip, type ScrubArm } from "./coin-words.ts";
import { buyButtonLabel, buyLabel } from "./screens/buy-button.ts";
import { coinPageSince, coinRowWords } from "./your-coins.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("item 9: each wallet chip is its name over its figure (\"SOL wallet\" / \"$169.37\"), spoken \"SOL wallet · $169.37\"", () => {
  const cases: [Parameters<typeof walletChip>, ReturnType<typeof walletChip>][] = [
    [["sol", 169.37], { name: "SOL wallet", figure: "$169.37", label: "SOL wallet · $169.37" }],
    // QA 16 (8 Nov): by its name, "Robinhood" alone so the tab fits (was "ETH (RH) wallet")
    [["hood", 28.17], { name: "Robinhood", figure: "$28.17", label: "Robinhood · $28.17" }],
    [["near", 0], { name: "NEAR wallet", figure: "$0.00", label: "NEAR wallet · $0.00" }],
    [["sol", undefined], { name: "SOL wallet", figure: null, label: "SOL wallet" }],          // not read yet: a shimmer, never $0.00
    [["bsc", Number.NaN], { name: "BNB wallet", figure: null, label: "BNB wallet" }],
  ];
  for (const [args, want] of cases) assert.deepEqual(walletChip(...args), want, JSON.stringify(args));
  const d = src("./screens/Discover.tsx");
  assert.match(d, /<span className="dc-tab-two"><span className="dc-tab-name">\{w\.name\}<\/span>/, "the name over the figure, on the chip");
  assert.match(d, /aria-label=\{walletChip\(c, v\)\.label\}/);
  assert.doesNotMatch(d, /aria-label=\{`Your \$\{CHAIN_SHORT\[c\]\} wallet/, "control: the bare-figure chip's label is gone");
});

test("item 9: a row's name is its own line, whole (it wraps to 2); its worth sits beside the symbol", () => {
  const cases: [Parameters<typeof rowLines>[0], ReturnType<typeof rowLines>][] = [
    [{ symbol: "SEASON", name: "Farming Season", marketCapUsd: 1_970_000 }, { cap: "$1.97M", name: "Farming Season" }],
    [{ symbol: "SWORDOPE", name: "dope wif sword", marketCapUsd: 1_670_000 }, { cap: "$1.67M", name: "dope wif sword" }],
    [{ symbol: "NEW", name: "New coin", marketCapUsd: 0 }, { cap: null, name: "New coin" }],
    [{ symbol: "X", name: "  ", marketCapUsd: undefined }, { cap: null, name: "X" }],
  ];
  for (const [r, want] of cases) assert.deepEqual(rowLines(r), want, r.symbol);
  const d = src("./screens/Discover.tsx"), css = src("./discover.css");
  assert.match(d, /<span className="dc-sub dc-sub--name"><span className="dc-name dc-name--whole">\{words\.name\}<\/span><\/span>/, "the name alone on its line");
  assert.match(d, /\{r\.symbol\}\{words\.cap && <span className="dc-cap">\{words\.cap\}<\/span>\}/, "the worth beside the symbol");
  assert.match(css, /\.dc-name--whole \{ display: -webkit-box; -webkit-line-clamp: 2;[^}]*white-space: normal;/, "two lines, never cut at one");
  assert.match(css, /\.dc-row \.zf-lrow__d:has\(> \.dc-sub--name\) \{ white-space: normal;/, "the row's line lets it wrap");
});

test("item 10: one 24 hours figure for the header and the chip (the row's with recorded prices, else the page's)", () => {
  const cases: [Parameters<typeof dayChangePct>, number | undefined][] = [
    [[true, 5.9, 5.0], 5.9],
    [[false, 5.9, 5.0], 5.0],
    [[true, undefined, 5.0], 5.0],
    [[false, 5.9, undefined], 5.9],
    [[false, undefined, Number.NaN], undefined],
  ];
  for (const [args, want] of cases) assert.equal(dayChangePct(...args), want, JSON.stringify(args));
  const moves = { m5: 1.9, h1: -3.5, h6: -15.8, h24: 5.0 };
  assert.deepEqual(moveFigures(moves, 5.9), { m5: 1.9, h1: -3.5, h6: -15.8, h24: 5.9 }, "the chip says the header's +5.9%, never the pool's +5.0%");
  assert.deepEqual(moveFigures(moves, undefined), moves, "no header figure: the pool's own");
  assert.deepEqual(moveFigures({ m5: 1, h1: undefined }, undefined), { m5: 1 }, "a window it hasn't is left out");
  const p = src("./screens/CoinPage.tsx");
  assert.match(p, /const ch = dayChangePct\(fromRow, seed\.change24hPct, d\?\.change24hPct\);/);
  assert.match(p, /const figures = moveFigures\(d\?\.moves, ch\);/, "the chips read the header's field");
  assert.doesNotMatch(p, /const v = d\?\.moves\?\.\[w\]/, "control: the chips' own read is gone");
});

test("T1: the coin page names the network, never the venue (\"On Solana\", not \"SOL · PumpSwap\"), nor its pools", () => {
  const p = src("./screens/CoinPage.tsx");
  assert.match(p, /const where = `On \$\{CHAIN_NAME\[seed\.chain\]\}`;/);
  assert.match(p, /<div key=\{p\.address\} className="tr-kv"><span>\{CHAIN_NAME\[seed\.chain\]\}<\/span>/, "Where it trades: Solana");
  assert.doesNotMatch(p, /const where = `\$\{CHAIN_SHORT/, "control: the venue line is gone");
  assert.doesNotMatch(p, /<span>\{dexName\(p\.dex\)\}<\/span>/, "control: no pool's name in a row");
});

test("T1: the header's change in words: \"Up $0.0002 (5.9%) in the last 24 hours\", \"Down $0.0011 (23.8%) this week\"", () => {
  const cases: [Parameters<typeof headerChange>, string][] = [
    [[0.000185, 5.9], "Up $0.0002 (5.9%)"],
    [[-0.00108, -23.8], "Down $0.0011 (23.8%)"],          // never "-$0.001"
    [[2.1, 8.4], "Up $2.10 (8.4%)"],
    [[-0.0000468, -1.2], "Down $0.000047 (1.2%)"],
    [[0.00000001, 0.01], "No change"],
  ];
  for (const [args, want] of cases) assert.equal(headerChange(...args), want, JSON.stringify(args));
  assert.equal(moveUsd(1234.5), "$1,234.50");
  const p = src("./screens/CoinPage.tsx");
  assert.match(p, /\{headerChange\(moved\.usd, moved\.pct\)\}<\/span> <span className="tr-mute">\{rangeWords\(range, whole\)\}<\/span>/);
  assert.doesNotMatch(p, /moveWords\(moved/, "control: the signed figures are gone");
});

test("T5: the holding says Up or Down in words (\"Down $0.11 (0.4%)\"); the row and the page say the same", () => {
  const cases: [Parameters<typeof holdingChange>, string][] = [
    [[-0.11, -0.4], "Down $0.11 (0.4%)"],
    [[0.11, 0.4], "Up $0.11 (0.4%)"],
    [[6.1, 17.378917378917376], "Up $6.10 (17.4%)"],
    [[-5.1, undefined], "Down $5.10"],
    [[1234.5, 12], "Up $1,234.50 (12.0%)"],
    [[0, 0], "No change"],
  ];
  for (const [args, want] of cases) assert.equal(holdingChange(...args), want, JSON.stringify(args));
  // the shot's holding: 7,505 DOPE bought for $25.00, worth $24.89 at the page's price
  const pos = { chain: "sol", coin: "dope", raw: "7505000000", decimals: 6, costUsd: 25, valueUsd: 24.89 } as Parameters<typeof coinRowWords>[0];
  const page = coinPageSince(pos, 24.89 / 7505) as { text: string };
  assert.equal(page.text, "Down $0.11 (0.4%)");
  assert.equal(coinRowWords(pos).since, page.text, "Your coins' row says the same words");
  assert.doesNotMatch(page.text, /^[+−]/, "control: no bare signed figures");
});

test("T2: plain stat labels, and the page's times as dates (\"6 Nov, 10:41 pm\", never \"now\" or \"2 min\")", () => {
  assert.deepEqual(STAT_LABELS, { cap: "Market cap", pool: "Money in the pool", traded: "Traded in the last day", holders: "People holding", age: "Age", top10: "Top 10 wallets own" });
  const cases: [number, string][] = [
    [new Date(2026, 10, 6, 22, 41).getTime(), "6 Nov, 10:41 pm"],
    [new Date(2026, 10, 6, 0, 5).getTime(), "6 Nov, 12:05 am"],
    [new Date(2026, 0, 31, 12, 0).getTime(), "31 Jan, 12:00 pm"],
    [new Date(2026, 4, 2, 9, 7).getTime(), "2 May, 9:07 am"],
  ];
  for (const [ms, want] of cases) assert.equal(dayTime(ms), want);
  const p = src("./screens/CoinPage.tsx");
  assert.match(p, /<span>\{usd\(t\.usd\)\} · \{dayTime\(t\.t\)\}<\/span>/, "trades' times as dates");
  assert.match(p, /\{scrub \? dayTime\(scrub\.t\) : moved/, "the finger's moment, date first");
  assert.doesNotMatch(p, /agoText\(Date\.now\(\) - t\.t\)/, "control: no \"2 min\"");
  assert.match(src("./coinpage.css"), /\.cp \.cp-stat \.zf-small \{ white-space: normal; overflow: visible; text-overflow: clip;/, "the plain labels wrap whole (the after walk cut \"Money in the p…\")");
});

test("T4: the buy button reads \"Buy $25.00\" (two decimals, the coin named once, in the title); the task keeps the coin", () => {
  const cases: [string, string][] = [["25", "Buy $25.00"], ["1.5", "Buy $1.50"], ["1000", "Buy $1,000.00"], ["0", "Choose an amount"], ["", "Choose an amount"]];
  for (const [v, want] of cases) assert.equal(buyButtonLabel(v), want, v);
  assert.equal(buyLabel("25", "DOPE"), "Buy $25 of DOPE", "control: the task's title (Activity) still names the coin");
  assert.match(src("./screens/TradeSheet.tsx"), /label: side === "buy" \? buyButtonLabel\(value\) : label2/);
});

test("item 10: first paint has no cursor and reads \"Now\"; a live feed says Live; a finger's moment says neither", () => {
  const cases: [Parameters<typeof priceWord>[0], ReturnType<typeof priceWord>][] = [
    [{ scrubbing: false, stale: false, recorded: true, feed: undefined }, "Now"],     // the Sim
    [{ scrubbing: false, stale: false, recorded: false, feed: "live" }, "Live"],
    [{ scrubbing: false, stale: false, recorded: false, feed: "polling" }, "Now"],
    [{ scrubbing: false, stale: true, recorded: false, feed: "live" }, null],          // "Updated … ago" says it
    [{ scrubbing: true, stale: false, recorded: true, feed: undefined }, null],        // the moment's time shows
  ];
  for (const [s, want] of cases) assert.equal(priceWord(s), want, JSON.stringify(s));
  // the cursor waits for a finger: the tap that opened the page leaves a pointer resting on the chart, not a scrub
  const seq = (evs: { type: "down" | "move"; x: number; y: number }[]): ScrubArm => evs.reduce(armScrub, { armed: false } as ScrubArm);
  assert.equal(seq([]).armed, false, "first paint: no cursor");
  assert.equal(seq([{ type: "move", x: 195, y: 300 }]).armed, false, "a pointer resting where the tap was");
  assert.equal(seq([{ type: "move", x: 195, y: 300 }, { type: "move", x: 196, y: 301 }]).armed, false, "a jitter under 2 px");
  assert.equal(seq([{ type: "move", x: 195, y: 300 }, { type: "move", x: 220, y: 300 }]).armed, true, "a real move over the chart");
  assert.equal(seq([{ type: "down", x: 10, y: 10 }]).armed, true, "a finger down");
  const c = src("./Chart.tsx"), p = src("./screens/CoinPage.tsx");
  assert.match(c, /vertLine: \{ visible: false, color:/, "the line is hidden until armed");
  assert.match(c, /if \(!arm\.armed \|\| !e\.time \|\| !e\.point\) \{ say\(null\); return; \}/, "an unarmed crosshair says nothing");
  assert.match(p, /\{word === "Now" && <span className="zf-live-word cp-live cp-now">Now<\/span>\}/);
});

test("QA 16 (8 Nov): the strip's tab says \"Robinhood\" alone, clear of the fade at 390 pt (10 pt gaps, 8 pt before Move)", () => {
  assert.equal(walletChip("hood", 1).name, "Robinhood");
  const css = readFileSync(new URL("./discover.css", import.meta.url), "utf8");
  assert.match(css, /\.dc-tabs \{ gap: 14px; \}\n[^]*?\.dc-tabs \{ gap: 10px; margin-right: 8px; \}/);
});
