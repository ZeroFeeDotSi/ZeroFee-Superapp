// A coin list's age on screen (audit 2 Nov): read again once a minute while shown, and marked with the time it is from
// when it is an older answer or the read meant to replace it failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asOfText, fromAgoText, LIST_REFRESH_MS, listAsOf } from "./list-age.ts";

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

test("an older answer says the time it is from; a fresh one says nothing", () => {
  const t = Date.parse("2026-11-02T02:41:00Z");
  assert.equal(asOfText(t, hhmm), " · as of 02:41");
  assert.equal(asOfText(undefined, hhmm), "");
  assert.equal(asOfText(Number.NaN, hhmm), "");
});

test("the rows' own asOf first; else the time they were read, only once the read meant to replace them failed", () => {
  const readAt = Date.parse("2026-11-02T02:40:00Z"), asOf = Date.parse("2026-11-01T22:00:00Z");
  assert.equal(listAsOf(Object.assign([], { asOf }), readAt, false), asOf);
  assert.equal(listAsOf(Object.assign([], { asOf }), readAt, true), asOf);
  assert.equal(listAsOf([], readAt, false), undefined, "fresh rows: no mark");
  assert.equal(listAsOf([], readAt, true), readAt, "the refresh failed: they are as old as their read");
  assert.equal(listAsOf(null, readAt, true), undefined);
});

test("a list on screen is read again once a minute: no faster than the market's own list cache", () => {
  assert.equal(LIST_REFRESH_MS, 60_000);
});

test("an old list says how old in one line, no label over it (design review item 21)", () => {
  assert.equal(fromAgoText(61_000), "From 1 min ago");
  assert.equal(fromAgoText(125_000), "From 2 min ago");
  assert.equal(fromAgoText(90 * 60_000), "From 2 h ago");
  assert.equal(fromAgoText(0), "From 1 min ago", "control: never 0 min");
});
