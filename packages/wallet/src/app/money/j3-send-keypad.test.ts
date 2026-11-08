// J3-2 (the copy review's walk of main 0538e5f38, 8 Nov, MUST): with an address and a network set, Send's ". 0 ⌫" sat under the
// floor's fade, and "Base" chosen sat under the network strip's fade. Fails on main: the keypad is the scroll box's last
// child, and chip-view.ts does not exist. Controls: the button stays the floor's last child; a whole chip is left as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chipScroll } from "./chip-view.ts";

const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
const body = form.slice(form.indexOf('<div className="wl-send2__scroll">'));

test("J3-2: Send's keypad is pinned on the floor with its button, never in the scrolling form under the fade; control: the floor's fade and its button stay", () => {
  const scroll = body.slice(0, body.indexOf('<div className="wl-send2__floor">'));
  const floor = body.slice(body.indexOf('<div className="wl-send2__floor">'));
  assert.doesNotMatch(scroll, /<Keypad /, "fails on main: the keypad was the scroll box's last child, under the floor's fade");
  assert.match(floor, /^<div className="wl-send2__floor">[\s\S]{0,700}<Keypad /, "the keypad heads the floor");
  assert.ok(floor.indexOf("<Keypad ") < floor.indexOf('data-testid="send-go"'), "control: the button under the keypad, the floor's last");
  const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-send2__floor::before \{[^}]*bottom: 100%/, "control: the fade sits over the form's tail, above the floor (and the keypad)");
  assert.match(css, /\.wl-send2__scroll \{ padding-bottom: 20px; scroll-padding-bottom: 20px; \}/, "the form's last line scrolls clear of the fade");
  // the dollars the keypad types are scrolled into sight
  assert.match(form, /<div className="wl-send2__amount" ref=\{amountBox\}>/);
  assert.match(form, /amountBox\.current\?\.scrollIntoView\?\.\(\{ block: "nearest" \}\); \}, \[shown, network\]\)/);
});

test("J3-2: the chosen network chip is always whole, clear of the strip's 24 px fade, by the strip's own numbers; control: a whole chip is not moved", () => {
  // a 342 px strip, the fade its last 24 px: "Base" at 300..360 sits under it -> scrolled so its right edge is 24 px clear
  assert.equal(chipScroll(0, 342, 300, 60), 42);
  assert.equal(300 + 60 - 42, 342 - 24, "its right edge ends where the fade starts");
  // a chip left of the view: its left edge
  assert.equal(chipScroll(120, 342, 40, 80), 40);
  // a chip wider than the clear part: its left edge, never past it
  assert.equal(chipScroll(0, 100, 50, 200), 50);
  // control: whole already, nothing moves
  assert.equal(chipScroll(0, 342, 100, 120), 0);
  assert.equal(chipScroll(42, 342, 300, 60), 42);
  // the strip runs it on the pick, and when the strip mounts after the pick (an address read again)
  assert.match(form, /showChosen\(netsRow\.current\); \}, \[network, networks\.length, !!who\]\)/);
});
