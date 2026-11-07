// QA 20 (8 Nov): Private's headline stays the true figure with "$X on its way to your Safe" right under it. The line
// shows at the tap (onMade, ids null), but the rows are re-read only after the core answered (homeFromPrivate's
// refresh), so until then the page read "$33.86" over "$33.86 on its way to your Safe": the same money twice. Now the
// headline is what Private held at the tap less what is leaving, never above the live read. Fails on main: no private-headline.ts, the headline the live read alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "./private-headline.ts";

const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");

test("QA 20: move-all, before the re-read: the headline is $0.00 under the tap, not the $33.86 that is on its way; after the re-read the same", () => {
  assert.equal(typeof P.headlineUsd, "function", "fails before: no headlineUsd");
  assert.equal(P.headlineUsd(33.86, { usd: "$33.86", at: 33.86 }), 0, "before the rows are re-read");
  assert.equal(P.headlineUsd(0, { usd: "$33.86", at: 33.86 }), 0, "after the re-read: the live $0.00");
});

test("QA 20: the one-slider part: what stays ($13.86 of $33.86 when $20.00 leaves); a re-read lower than that wins; a figure with a comma reads whole", () => {
  assert.equal(P.headlineUsd(33.86, { usd: "$20.00", at: 33.86 }), 13.86);
  assert.equal(P.headlineUsd(13.86, { usd: "$20.00", at: 33.86 }), 13.86, "after the re-read");
  assert.equal(P.headlineUsd(5, { usd: "$20.00", at: 33.86 }), 5, "never above the live read");
  assert.equal(P.headlineUsd(1250.5, { usd: "$1,000.25", at: 1250.5 }), 250.25);
});

test("controls: nothing on its way, or no figure at the tap, or no dollars said: the live read as it is", () => {
  assert.equal(P.headlineUsd(33.86, null), 33.86);
  assert.equal(P.headlineUsd(33.86, { usd: "$33.86" }), 33.86, "no tap figure kept");
  assert.equal(P.headlineUsd(33.86, { usd: "", at: 33.86 }), 33.86, "no dollars");
  assert.equal(P.headlineUsd(33.86, { usd: "$40.00", at: 33.86 }), 0, "never below $0.00");
});

test("the page: the headline reads headlineUsd; the tap keeps the figure Private held then (first onMade), the core's answer keeps it; the on-its-way line stays right under the headline", () => {
  assert.match(src, /import \{ headlineUsd \} from "\.\/private-headline\.ts";/);
  assert.match(src, /<p className="wl-display">\{dollars\(headlineUsd\(live, away\)\.toFixed\(2\)\)\}<\/p>/);
  assert.match(src, /const live = Number\(pocket \? privateAllUsd\(pocket\) : privateUsd\(rows\)\);/);
  assert.match(src, /setAway\(\(was\) => \(o \? \{ \.\.\.o, at: was\?\.at \?\? live \} : null\)\)/);
  assert.match(src, /<p className="wl-display">[^\n]*<\/p>\n[^\n]*\n\s*\{away && <OnItsWay away=\{away\} activity=\{activity\} onEnd=\{onEnd\} \/>\}/);
});
