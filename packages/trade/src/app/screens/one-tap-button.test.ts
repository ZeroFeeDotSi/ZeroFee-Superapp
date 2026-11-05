// The Buy/Sell button's double click (QA's sd-errors crawl, 4 Nov: two clicks 4 ms apart both passed `busy`,
// React state set only on the next render, so the sheet sent two trades and published two task rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOneTap } from "./buy-button.ts";

/** The sheet's tap as it runs: the `busy` it reads is the render's (stale until React renders again). */
function sheet(lock: boolean) {
  const one = createOneTap();
  const busy = false;
  let trades = 0, tasks = 0;
  const tap = async () => {
    if (busy || (lock && !one.take())) return;
    tasks++;
    try { trades++; await new Promise((r) => setTimeout(r, 5)); } finally { one.done(); }
  };
  return { tap, counts: () => ({ trades, tasks }) };
}

test("a double click: one trade, one task row", async () => {
  const s = sheet(true);
  await Promise.all([s.tap(), s.tap()]);
  assert.deepEqual(s.counts(), { trades: 1, tasks: 1 });
});

test("control: without the lock, the stale `busy` lets the double click send two", async () => {
  const s = sheet(false);
  await Promise.all([s.tap(), s.tap()]);
  assert.deepEqual(s.counts(), { trades: 2, tasks: 2 });
});

test("the lock opens again once the tap ends: the next click is a new trade", async () => {
  const s = sheet(true);
  await s.tap();
  await s.tap();
  assert.deepEqual(s.counts(), { trades: 2, tasks: 2 });
});

test("TradeSheet's tap takes the lock before setBusy and any await, and lets it go in its finally", () => {
  const src = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  const tap = src.slice(src.indexOf("const tap = async () => {"), src.indexOf("const q = quote.p?.quote;"));
  assert.match(tap, /^const tap = async \(\) => \{\n\s+if \(!canTap\(quote, intent, busy\) \|\| !quote\.p \|\| !oneTap\.take\(\)\) return;\n\s+setBusy\(true\);/);
  assert.ok(tap.indexOf("oneTap.take()") < tap.indexOf("await "), "taken before any await");
  assert.match(tap, /finally \{ setBusy\(false\); oneTap\.done\(\); \}/);
  assert.match(src, /const oneTap = useRef\(createOneTap\(\)\)\.current;/);
});
