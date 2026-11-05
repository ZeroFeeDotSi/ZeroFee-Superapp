// S10b (the copy review's Sim walk, 5 Nov): an Activity row's page closed about two seconds after the tap, because the live Jobs
// tracker, drawing through the same overlay, set it to null on every read of its jobs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownSlot } from "./overlay-slot.ts";

test("two drawers on one overlay: a drawer's null never takes away the other's page (control: its own page it does take away)", () => {
  let shown: unknown = null;
  const set = (n: unknown) => { shown = n; };
  const page = ownSlot(set), tracker = ownSlot(set);
  page.draw("row page");
  tracker.draw(null); // the tracker's read of its jobs, nothing of its own open
  assert.equal(shown, "row page");
  tracker.release(); // the tracker goes, having drawn nothing
  assert.equal(shown, "row page");
  page.draw(null); // control: the page's own Close
  assert.equal(shown, null);
  tracker.draw("tracker");
  assert.equal(shown, "tracker");
  tracker.release(); // control: what it drew goes with it
  assert.equal(shown, null);
});

test("Activity and the live tracker draw through ownSlot, never overlay(null) straight (the bug's shape)", () => {
  for (const f of ["./screens/Activity.tsx", "./money/LiveTrack.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /ownSlot\(overlay\)/, f);
    assert.doesNotMatch(src, /overlay\(null\)|overlay\(tracker\)|overlay\(detail\)/, f);
  }
});
