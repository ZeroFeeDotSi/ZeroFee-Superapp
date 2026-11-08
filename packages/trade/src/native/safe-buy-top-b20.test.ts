// Builder QA's item 1 (audit 16's S16-14, the review's tick 69 edge): the Safe's Buy and Sell said their down line in the
// middle of the sheet (the "about" line under the amount) where Swap and Move say it ON TOP, full width, with "See their
// status" under it (design SheetTop). Now the sheet's problem is on top; while it can't go no promise line is said (what it
// pays with, at least, through NEAR Confidential); the fee line stays. Fails on main: the about line holds services.line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NATIVE_COPY as W } from "./words.ts";

const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");
const body = (() => { const s = read("packages/trade/src/native/NativeScreens.tsx"); return s.slice(s.indexOf("export function NativeTradeSheet")); })();

test("item 1: the down line (or offline) is the sheet's top, before the coin and the amount", () => {
  const top = body.indexOf("<SheetTop text={online ? services.line : W.offline(");
  assert.ok(top > 0, "SheetTop on the Safe's Buy and Sell");
  assert.ok(top < body.indexOf('<div className="tp-coin">'), "above the coin");
  assert.ok(top < body.indexOf('className="tp-amt"'), "above the amount");
});

test("item 1: the middle of the sheet says nothing while it can't go", () => {
  assert.match(body, /data-testid="native-about">\{services\.line \? " " : capped/, "the about line never holds the down line");
  assert.doesNotMatch(body, /services\.line \? services\.line/);
  assert.match(body, /\{!services\.down && <p className="tp-pay nc-pay" data-testid="native-pay">/, "no pays-with line");
  assert.match(body, /\{!services\.down && <p className="zf-small nc-who"/, "no through line");
  assert.match(body, /q && !capped && !services\.line \? W\.atLeast/, "no at-least line");
  assert.match(body, /data-testid="native-paid">\{intentsKept/, "control: the fee line stays");
});

test("item 1: offline says the four-part line once, Swap's and Send's", () => {
  assert.equal(W.offline("Buy"), "You're offline. Your money is safe. Buy works again when you're back. It checks again by itself.");
});
