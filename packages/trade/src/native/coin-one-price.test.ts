// Audit 10's A1 and A2 (8 Nov), the coin page. A1: the NEAR page priced NEAR at $3.66 (hero, Buy sheet) while it valued
// the holding at $4.43 a coin (Home's own figure): now one price per coin on the page, the hero's, and the holding is
// valued at it. A2: Worth / Liquidity / Traded 24h shimmered for good when the pools never answered, and the range tabs
// sat live under "No chart for this coin yet.": the shimmer stops after FACTS_WAIT_MS and the rows drop; no chart, no tabs.
// Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACTS_WAIT_MS, heldWorth, rangesShown } from "./look.ts";

const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");

test("A1: the holding's dollars are its amount at the hero's own price (the one Buy fills at); no price, no dollars (control: Home's figure is never the page's dollars)", () => {
  assert.equal(Number(heldWorth("326.9", 3.66)).toFixed(2), "1196.45", "326.9 NEAR at the hero's $3.66");
  assert.equal(heldWorth("326.9", undefined), "", "no price yet: no dollars beside a shimmering hero");
  assert.equal(heldWorth("0", 3.66), "", "nothing held: no figure");
  // audit 12's C3: the hero's price is now Home's (one-price.ts), so at it Home's own figure is the page's (one-price-home.test.ts)
  assert.match(page, /const shownHeld = heldAmount \? \{ amount: heldAmount, usd: figure && book\.has\(assetId\) \? figure\.usd : heldWorth\(heldAmount, px\) \} : null;/, "the page values the holding at px");
  assert.match(page, /const px = coinPrice\(book, assetId, symbol, facts\?\.priceUsd, row\?\.price\);/, "px is the hero's price");
  assert.doesNotMatch(page, /const shownHeld = figure \?\?/, "control: Home's figure at another price is never the shown one");
});

test("A2: the pools' figures shimmer at most FACTS_WAIT_MS, then the rows that never came drop; the range tabs show only over a chart (controls: facts that come show; a picked range keeps its tabs)", () => {
  assert.ok(FACTS_WAIT_MS > 0 && FACTS_WAIT_MS <= 10_000, "a limit a person waits for");
  // audit 12's C9 went further: no shimmer box at all, a box only with its figure (coin-page-boxes.test.ts)
  assert.match(page, /const stats = statsShown\(/, "only figures that came");
  assert.equal(rangesShown(true, false), false, "no chart on the first range: no tabs");
  assert.equal(rangesShown(false, false), true, "control: a chart has its tabs");
  assert.equal(rangesShown(true, true), true, "control: a range the person picked keeps its tabs, so another can be picked");
  assert.match(page, /\{RELAY && rangesShown\(noChart, picked\) && <div className="tr-tabs tr-ranges" role="tablist">/);
});
