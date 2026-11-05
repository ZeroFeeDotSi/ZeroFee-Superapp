// J2 (2 Nov): the swipe between apps decides like a person expects. A quarter of the width or a flick moves one app; a
// vertical scroll is never taken; a reversed drag comes back; the ends give a little and spring back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AXIS_BIAS, EDGE_PX, FLICK, SLOP_PX, SWITCH_AT, clampPos, fingerVelocity, fromEdge, lockAxis, releaseTarget } from "./swipe.ts";

test("direction lock: nothing is decided inside the slop; across is the shell's, down (or a near-diagonal) is the scroll's", () => {
  assert.equal(lockAxis(4, 3), null, "a 5 px wobble decides nothing");
  assert.equal(lockAxis(SLOP_PX - 1, 0), null);
  assert.equal(lockAxis(-14, 2), "x", "a drag across");
  assert.equal(lockAxis(14, 2), "x");
  assert.equal(lockAxis(2, 14), "y", "a scroll down");
  assert.equal(lockAxis(-3, -20), "y", "a scroll up");
  // a 45° drag is a scroll: a page that scrolls must never be taken by the shell
  assert.equal(lockAxis(12, 12), "y");
  assert.equal(lockAxis(12 * AXIS_BIAS - 0.5, 12), "y");
  assert.equal(lockAxis(12 * AXIS_BIAS + 0.5, 12), "x");
  // control: the same move scaled below the slop stays undecided, so the lock can fail for distance alone
  assert.equal(lockAxis(5, 1), null);
});

test("release: a quarter of the width moves one app; less springs back", () => {
  const count = 5;
  assert.equal(releaseTarget({ start: 1, pos: 1 + SWITCH_AT + 0.01, velocity: 0, count }), 2, "past a quarter, to the next");
  assert.equal(releaseTarget({ start: 1, pos: 1 + SWITCH_AT - 0.01, velocity: 0, count }), 1, "short of it, back");
  assert.equal(releaseTarget({ start: 1, pos: 1 - SWITCH_AT - 0.01, velocity: 0, count }), 0, "to the one before");
  assert.equal(releaseTarget({ start: 1, pos: 0.85, velocity: 0, count }), 1);
  // the old rule needed 70%: a 30% drag must now switch (the auditor's mid-screen swipe)
  assert.equal(releaseTarget({ start: 1, pos: 1.3, velocity: 0, count }), 2);
});

test("release: a quick flick moves one app however short; a slow one doesn't", () => {
  const count = 5;
  assert.equal(releaseTarget({ start: 2, pos: 2.06, velocity: FLICK + 0.1, count }), 3, "a short fast flick to the next");
  assert.equal(releaseTarget({ start: 2, pos: 1.94, velocity: -(FLICK + 0.1), count }), 1, "and back");
  assert.equal(releaseTarget({ start: 2, pos: 2.06, velocity: FLICK - 0.1, count }), 2, "control: the same drag, slower, stays");
  // a flick never jumps two apps, however fast
  assert.equal(releaseTarget({ start: 2, pos: 2.9, velocity: 40, count }), 3);
});

test("release: a reversed drag comes back; a flick back from past the quarter comes back too", () => {
  const count = 5;
  assert.equal(releaseTarget({ start: 1, pos: 1.4, velocity: -(FLICK + 1), count }), 1, "flicked back from 40%: stays");
  assert.equal(releaseTarget({ start: 1, pos: 1.2, velocity: -0.2, count }), 1, "dragged to 60% and slowly back to 20%: stays");
  assert.equal(releaseTarget({ start: 1, pos: 0.7, velocity: FLICK + 1, count }), 1, "the other way");
});

test("release: never past the first or the last app", () => {
  assert.equal(releaseTarget({ start: 0, pos: -0.2, velocity: -5, count: 5 }), 0);
  assert.equal(releaseTarget({ start: 4, pos: 4.2, velocity: 5, count: 5 }), 4);
  assert.equal(releaseTarget({ start: 0, pos: 0.5, velocity: 0, count: 1 }), 0);
});

test("firm ends (bug report, 4 Nov): inside the apps a drag is 1:1; past the first or the last app the pages hold still", () => {
  assert.equal(clampPos(2.37, 5), 2.37);
  assert.equal(clampPos(0, 5), 0);
  assert.equal(clampPos(-0.4, 5), 0);
  assert.equal(clampPos(4.5, 5), 4);
});

test("edge only (bug report, 4 Nov): a drag moves between apps only when it lands at the screen's left or right edge", () => {
  assert.equal(fromEdge(0, 390), true);
  assert.equal(fromEdge(EDGE_PX, 390), true);
  assert.equal(fromEdge(390 - EDGE_PX, 390), true);
  assert.equal(fromEdge(EDGE_PX + 1, 390), false, "the page's own content: the frame stays put");
  assert.equal(fromEdge(195, 390), false);
});

test("finger speed: from the last 100 ms of moves; a finger that stopped before letting go has none", () => {
  const moves = [{ t: 0, x: 0 }, { t: 50, x: -10 }, { t: 100, x: -60 }, { t: 116, x: -100 }];
  const v = fingerVelocity(moves, 120);
  assert.ok(v < -1.3 && v > -1.6, `${v} px/ms`);
  assert.equal(fingerVelocity(moves, 116 + 90), 0, "held still 90 ms, then lifted: no flick");
  assert.equal(fingerVelocity([{ t: 0, x: 0 }], 5), 0);
  // moves that come sparsely (a slow device, 60 ms apart) still give the speed from the move before the last
  const sparse = [{ t: 0, x: 0 }, { t: 60, x: -40 }, { t: 120, x: -80 }];
  assert.ok(Math.abs(fingerVelocity(sparse, 140) - -40 / 60) < 1e-9);
  // control: two moves 400 ms apart are no flick, however far
  assert.equal(fingerVelocity([{ t: 0, x: 0 }, { t: 400, x: -200 }], 410), 0);
});

test("the shell's swipe: from the screen's edge only (no edge strip elements), touch kept apart from a vertical scroll, never on a sheet, field, chart or sideways scroller", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./apphost.css", import.meta.url), "utf8");
  assert.doesNotMatch(host, /ah-edge/, "no edge strips: the edge is read from where the finger lands");
  assert.doesNotMatch(css, /\.ah-edge/);
  assert.match(host, /if \(!r \|\| !fromEdge\(\(x - r\.left\) \/ scale\(\), width\(\)\)\) return;/, "a drag across the page never moves the frame");
  assert.match(host, /pos\.current = clampPos\(raw, apps\.length\);/, "firm ends");
  assert.match(host, /addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/, "a horizontal drag can stop the page scrolling");
  assert.match(host, /const NO_SWIPE = '\[role="dialog"\], \.zf-sheet, input, textarea, select, canvas/);
  assert.match(host, /overflowX;\s*if \(o === "auto" \|\| o === "scroll"\) return false;/, "a carousel keeps its own swipe");
  // motion is the spring, never a CSS transition on the pages (the old .3s ease-out) and never a chain of timers
  assert.doesNotMatch(css, /\.ah-(track|page)[^{]*\{[^}]*transition/);
  assert.match(host, /flight\.current = slide\(/, "the spring, run by the compositor (slide.ts)");
  assert.doesNotMatch(host, /setTimeout\([^)]*(go|setIndex|paint)/);
});
