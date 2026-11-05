// Sample-page crawl, 4 Nov (sim-security, note 17): "A move to a new device has stopped… Get new words" followed every
// app, couldn't be closed and covered Security's "Check my words". Now the freeze is the shell's one line, only over Home
// and Security; a stopped move has its ×, kept across reloads; a move under way stays pinned; it leaves when resolved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FREEZE_APPS, freezeNotice, freezeNoticeItem } from "./freeze.ts";
import { loadHidden, NOTICE_HIDDEN_STORE, pickNotice, rememberHidden, RANK, type NoticeItem } from "./notices.ts";

const now = Date.UTC(2026, 10, 4, 12);
const until = new Date(now + 3 * 86_400_000).toISOString();
const when = (iso: string) => `[${iso}]`;
const stopped = freezeNotice({ pending: null, frozenUntilIso: until }, now, when)!;
const moving = freezeNotice({ pending: { readyAtIso: until }, frozenUntilIso: until }, now, when)!;

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("a stopped move: one line with its ×, only over Home and Security, and its × is remembered", () => {
  const item = freezeNoticeItem(stopped, null);
  assert.equal(item.line, `A move to a new device has stopped. Payments wait until [${until}].`);
  assert.equal(item.pinned, undefined, "it can be closed");
  assert.equal(item.remember, true);
  assert.deepEqual(item.apps, ["wallet", "security"]);
  assert.equal(pickNotice([item], new Set(), "wallet")?.key, item.key, "on Home");
  assert.equal(pickNotice([item], new Set(), "security")?.key, item.key, "on Security (Devices)");
  for (const other of ["trade", "browser", "agentzero", "pay"]) assert.equal(pickNotice([item], new Set(), other), null, `not over ${other}`);
  assert.equal(pickNotice([item], new Set([item.key]), "wallet"), null, "× hides it");
  // remembered across a reload: a new bar reads it back; a changed line (a new freeze) is a new key and shows again
  const store = memory();
  rememberHidden(item.key, store);
  assert.ok(loadHidden(store).has(item.key));
  assert.equal(pickNotice([item], loadHidden(store), "wallet"), null, "after a reload, still closed");
  const later = freezeNoticeItem(freezeNotice({ pending: null, frozenUntilIso: new Date(now + 4 * 86_400_000).toISOString() }, now, when)!, null);
  assert.notEqual(later.key, item.key);
  assert.equal(pickNotice([later], loadHidden(store), "wallet")?.key, later.key, "a new freeze shows again");
  // storage that can't be read: nothing remembered, nothing thrown
  assert.equal(loadHidden({ getItem: () => { throw new Error("blocked"); } }).size, 0);
  store.m.set(NOTICE_HIDDEN_STORE, "not json");
  assert.equal(loadHidden(store).size, 0);
});

test("a move under way (a possible takeover) stays until it's resolved, but still only over Home and Security", () => {
  const item = freezeNoticeItem(moving, null);
  assert.equal(item.line, "Someone is moving your account.", "one line that fits the bar (the banner's sentence ran off it)");
  assert.equal(item.pinned, true);
  assert.equal(item.remember, undefined);
  assert.equal(pickNotice([item], new Set([item.key]), "wallet")?.key, item.key, "× can't hide it");
  assert.equal(pickNotice([item], new Set(), "trade"), null, "not over Trade");
  assert.ok(item.rank === RANK.freeze);
});

test("resolved: once payments no longer wait, there's no line at all", () => {
  assert.equal(freezeNotice({ pending: null, frozenUntilIso: until }, Date.parse(until) + 1, when), null);
  assert.equal(freezeNotice({ pending: null, frozenUntilIso: null }, now, when), null);
});

test("a line without apps still shows over any app (control), and FREEZE_APPS names real apps", () => {
  const plain: NoticeItem = { key: "service:x", rank: RANK.service, line: "x" };
  assert.equal(pickNotice([plain], new Set(), "trade")?.key, "service:x");
  assert.equal(pickNotice([plain], new Set())?.key, "service:x");
  assert.deepEqual([...FREEZE_APPS], ["wallet", "security"]);
});

test("the app, the sample page and the gallery all draw the freeze as this one line (never a card over every app)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const app = read("../App.tsx");
  const demo = read("../gallery/Demo.tsx");
  const screens = read("../gallery/Screens.tsx");
  assert.match(app, /notice=\{freeze \? freezeNoticeItem\(freeze, <FreezeBanner [^]*? bare \/>\) : null\}/);
  assert.match(demo, /notice=\{freeze \? freezeNoticeItem\(freeze, <FreezeBanner [^]*? bare \/>\) : null\}/);
  assert.doesNotMatch(demo, /notice=\{freeze \? <FreezeBanner/, "control: the old card over every app is gone");
  assert.doesNotMatch(screens, /notice=\{<FreezeBanner/);
  const host = read("./AppHost.tsx");
  assert.match(host, /<NoticeBar items=\{\[[^]*?\]\} here=\{current\?\.id\} \/>/, "the bar knows which app is on screen");
  const bar = read("./NoticeBar.tsx");
  assert.match(bar, /useState<ReadonlySet<string>>\(\(\) => loadHidden\(\)\)/, "a remembered × is read back");
  assert.match(bar, /if \(n\.remember\) rememberHidden\(n\.key\)/);
});
