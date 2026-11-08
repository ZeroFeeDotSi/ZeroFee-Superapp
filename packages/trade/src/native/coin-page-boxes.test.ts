// Audit 12's C9 (8 Nov): NEAR's page from the Safe's tab showed "Worth | Liquidity | Traded 24h" over three grey boxes
// with no figure, and "No chart for this coin yet." for the Safe's biggest coin. Now a box shows only with its figure;
// a chart that didn't come says who didn't answer, by name, with Try again; a build with no price server draws no chart
// box (it asks no market) and its source line says NEAR Intents prices it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartDown, statsShown } from "./look.ts";
import { createNativeData } from "./data.ts";
import { NATIVE_COPY as W } from "./words.ts";

const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");

test("C9: a stat box only with its figure, never an empty or shimmering one (control: figures that came show, in order)", () => {
  assert.deepEqual(statsShown([["Worth", undefined], ["Liquidity", undefined], ["Traded 24h", undefined]]), [], "NEAR with no pools: no boxes");
  assert.deepEqual(statsShown([["Worth", 4.2e9], ["Liquidity", 0], ["Traded 24h", 1.5e6]]), [["Worth", 4.2e9], ["Traded 24h", 1.5e6]], "control");
  assert.deepEqual(statsShown([["Worth", Number.NaN]]), [], "a bad figure is none");
  assert.doesNotMatch(page, /cp-stat-sk/, "no shimmer box");
  assert.match(page, /const stats = statsShown\(/);
});

test("C9: a chart that didn't come names who didn't answer, with Try again (controls: CoinGecko, GeckoTerminal, the server)", async () => {
  const relay = "https://relay.example";
  const refused = () => new Response(JSON.stringify({ code: "quotes.market.refused" }), { status: 502 });
  const d = createNativeData({ relay, storage: null, fetch: (async () => refused()) as typeof fetch });
  const coin = { assetId: "nep141:wrap.near", symbol: "NEAR", decimals: 24, blockchain: "near", cgId: "near" } as never;
  const e = await d.candles(coin, "1D").then(() => null, (x: unknown) => x);
  assert.equal(chartDown(e), "CoinGecko", "CoinGecko's own refusal, passed on by the server");
  assert.equal(W.didntAnswer(chartDown(e)), "CoinGecko didn't answer.");
  const down = createNativeData({ relay, storage: null, fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
  assert.equal(chartDown(await down.candles(coin, "1D").then(() => null, (x: unknown) => x)), "ZeroFee's server", "the server itself unreachable");
  assert.equal(chartDown({ service: "gecko" }), "GeckoTerminal");
  assert.match(page, /chartFailed \? <>\{W\.didntAnswer\(chartFailed\)\} <button type="button" className="zf-link" onClick=\{\(\) => setChartTry\(\(n\) => n \+ 1\)\}>\{W\.retry\}<\/button><\/>/, "the line and its Try again");
  assert.match(page, /\}, \[row\?\.assetId, range, pool\?\.address, active, chartTry\]\);/, "Try again reads it again");
});

test("C9: no price server: no chart box and no range tabs (nothing is asked); the source line names NEAR Intents", () => {
  assert.match(page, /if \(!row \|\| !RELAY\) return;/, "no market read");
  assert.match(page, /\{RELAY && <div className="tr-chart-box cp-chart">/);
  assert.match(page, /\{RELAY && rangesShown\(noChart, picked\)/);
  assert.equal(W.sourceOf(true, false), "NEAR Intents prices it.");
  assert.equal(W.sourceOf(true, true), "NEAR Intents prices it. CoinGecko and GeckoTerminal draw the chart.");
  assert.equal(W.sourceOf(false, true), W.source, "control: a coin the ledger doesn't price keeps the market's line");
});
