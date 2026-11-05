// NEAR Intents' look helpers (look.ts), with controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowWorth } from "./look.ts";

test("a row's worth is short: whole above 100, one decimal under, never a cut figure (control: small worths stay whole)", () => {
  assert.equal(rowWorth(296.4e9), "$296B");
  assert.equal(rowWorth(11.33e9), "$11.3B");
  assert.equal(rowWorth(3e9), "$3B", ".0 is dropped");
  assert.equal(rowWorth(21.31e6), "$21.3M");
  assert.equal(rowWorth(1.62e12), "$1.6T");
  assert.equal(rowWorth(58_000), "$58K");
  assert.equal(rowWorth(999), "$999", "control: under a thousand is the dollars");
  for (const n of [296.4e9, 11.33e9, 21.31e6, 1.62e12, 58_000]) assert.ok(rowWorth(n).length <= 6, `${rowWorth(n)} fits beside the chip`);
});

// the build's NEAR Intents data on the look (5 Nov): the failed list names its source (rule 9a), Sell opens where sellStart
// says, "Pays from" says the Safe's cash, and no row has a dead "Not yet" path
import { readFileSync } from "node:fs";
import { NATIVE_COPY } from "./words.ts";
import { grade } from "../../../../tools/copy/voice.ts";
import { SERVICE_NAMES } from "@zerofee/core/services";
const screens = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");

test("rule 9a: the failed list says who isn't answering, by a name the person knows, that nothing moved and where the money is (control: no source, the plain line)", () => {
  const line = NATIVE_COPY.listFault(NATIVE_COPY.faultNames.oneclick, "down");
  assert.equal(line, "Prices come through NEAR Intents, and it isn't answering. Nothing moved. Your money is in your Safe.");
  assert.equal(NATIVE_COPY.listFault(SERVICE_NAMES.gecko, "busy"), "Prices come through GeckoTerminal, and it is busy. Nothing moved. Your money is in your Safe.");
  assert.deepEqual(NATIVE_COPY.faultNames, { oneclick: "NEAR Intents", coingecko: "CoinGecko", relay: "ZeroFee's server" });
  for (const who of [...Object.values(NATIVE_COPY.faultNames), SERVICE_NAMES.gecko]) for (const f of ["down", "busy", "slow"] as const) {
    const g = grade("packages/trade/src/native/words.ts", NATIVE_COPY.listFault(who, f));
    assert.equal(g.grade, "A", `${who} ${f}: ${g.problems.join("; ")}`);
  }
  // control: the guard still fails the words it should (the bare relay, a passive pause)
  assert.notEqual(grade("packages/trade/src/native/words.ts", NATIVE_COPY.listFault("ZeroFee's relay", "down")).grade, "A");
  assert.notEqual(grade("packages/trade/src/native/words.ts", "NEAR Intents isn't answering, so prices are paused.").grade, "A");
  assert.match(screens, /\{online \? faultLine\(nativeData\(\)\.fault\(\)\) : OFFLINE_SHORT\}/);
  assert.match(screens, /!f \? W\.listDown : W\.listFault\(f\.service === "gecko" \? SERVICE_NAMES\.gecko : W\.faultNames\[f\.service\]/);
  assert.ok(!/1Click/.test(NATIVE_COPY.listFault(NATIVE_COPY.faultNames.oneclick, "down")), "control: never 1Click by name");
});

test("Sell opens on sellStart once the band and holding are read, never over a pick; Pays from names the place only; every listed row has its chip", () => {
  assert.match(screens, /const s = sellStart\(heldUsd, band\);\n    if \(!s\.all && all && value === ""\) \{ setAll\(false\); setFresh\(true\); setValue\(s\.usd\); \}/);
  assert.match(screens, /if \(side !== "sell" \|\| started\.current \|\| band === undefined \|\| heldUsd === undefined\) return;/, "waits for both reads");
  // one figure per coin (Sim test, item 7): Pays from names the place, never a second USDC figure
  assert.match(screens, /<span>\{W\.paysFrom\}<\/span><span>\{W\.safeCash\}<\/span>/);
  assert.doesNotMatch(screens, /safeCashHas|setCash\(/, "control: the old figure is gone");
  assert.ok(!/\{safeCanSell\(r\.assetId\) && \(/.test(screens), "no dead Not-yet branch on a row: data.ts lists only coins the Safe can trade");
});

// a-nine (5 Nov; re-check): a long price (BLACKDRAGON) must not cut the row's name or worth mid-letter
test("a NEAR Intents row's middle cell may shrink, its name ends in an ellipsis, its worth wraps whole, a long price is smaller", () => {
  const css = readFileSync(new URL("./native.css", import.meta.url), "utf8");
  const tsx = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(css, /\.nc-row\.zf-lrow \{ grid-template-columns: 40px minmax\(0, 1fr\) auto; \}/);
  assert.match(css, /\.nc-row \.dc-sym \{ display: block; \}/);
  assert.match(css, /\.nc-row \.zf-lrow__d \{ white-space: normal; overflow: visible; \}/);
  assert.match(css, /\.nc-row \.dc-cap \{[^}]*flex: none;[^}]*overflow: visible/, "the worth is never clipped");
  assert.doesNotMatch(css, /\.nc-row \.dc-cap \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.nc-row \.dc-px--long \{ font-size: 13px; \}/);
  assert.match(tsx, /dc-px--long/);
});
