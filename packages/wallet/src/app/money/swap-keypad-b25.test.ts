// Builder 25, item 3 (audit 19's J5): with a problem line on top (design SheetTop: "Solana is down, so this can't go
// now..." or offline), Swap's keypad lost its last row (". 0 Delete" at 696-752 under a box that ended at 634, measured
// at 390x844 on ?demo&fault=solana:521). The keypad sat inside the form's scroll box; the copy review's J2-3 keeps its keys at 56 pt,
// so it was pushed out of sight. Now Send's shape: the keypad heads the floor (its own box, never scrolled), the form
// above it scrolls. Fails on main 437575a59.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./move-swap.css", import.meta.url), "utf8");
const last = (sel: string) => { const i = css.lastIndexOf(sel); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };

test("swap-keypad-b25: the keypad is the floor's first box, never inside the form's scroll", () => {
  const scroll = sheet.slice(sheet.indexOf('<div className="wl-swap2__scroll">'), sheet.indexOf('<div className="wl-swap2__floor">'));
  const floor = sheet.slice(sheet.indexOf('<div className="wl-swap2__floor">'), sheet.indexOf("</MoneySheet>"));
  assert.ok(scroll.includes("<SheetTop"), "the problem line stays on top of the form");
  assert.doesNotMatch(scroll, /<Keypad /, "fails on main: the keypad scrolled out under the problem line");
  assert.match(floor, /^<div className="wl-swap2__floor">\s*(\{\/\*[\s\S]*?\*\/\}\s*)*<Keypad /, "the floor's first box");
});

test("swap-keypad-b25: its keys keep 56 pt, and it keeps clear of the Who link's 44 pt tap under it", () => {
  assert.match(last(".wl-swap2__floor > .zf-keypad {"), /flex: none; min-height: 224px; grid-auto-rows: 56px; margin: 0 0 6px;/);
  assert.match(last(".wl-swap2__floor > .zf-keypad button {"), /height: 56px; min-height: 56px/);
  assert.doesNotMatch(css, /\.wl-swap2__scroll > \.zf-keypad/, "no rule left for a keypad in the scroll");
});

test("swap-keypad-b25: with a problem line on top the form tightens, so the dollars stay in sight over the keys", () => {
  assert.match(css, /\.wl-swap2__scroll:has\(> \.zf-money__top\) > \.wl-swap-amount \{ min-height: 56px; \}/);
  assert.match(css, /\.wl-swap2__scroll > \.zf-money__top > \.zf-body \{ font-size: 15px; line-height: 20px; \}/);
});
