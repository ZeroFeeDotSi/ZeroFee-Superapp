// Builder QA's item 3 (audit 16's S16-3, the review's edge on builder 17): on a 1280 window the laptop page's lock screen
// spread its words and its Use this laptop button across the whole window; its first two lines said one idea twice ("This
// page makes your laptop a second key for ZeroFee." then "This laptop is your key."); and it sent people to "Security" on
// the phone, whose place is Your account, Devices. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAPTOP_LOCK, LAPTOP_START } from "../unlock/laptop-lock-words.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("item 3: on the laptop page the lock screen's words and button keep a 480 px reading width, centred", () => {
  const css = read("../app.css");
  assert.match(css, /html\[data-mode="laptop"\] \.zf-screen > \.ul-center, html\[data-mode="laptop"\] \.zf-screen > \.zf-floor \{ width: 100%; max-width: 480px; margin-inline: auto;/);
});

test("item 3: the first screen says one idea once: the heading is what the page is, the line under it only how", () => {
  const gate = read("../unlock/UnlockGate.tsx");
  assert.match(gate, /title=\{laptopStart\?\.heading \?\? laptop\.setupTitle\} body=\{laptopStart \? laptop\.setupHow : laptop\.setupBody\}/, "the first paint");
  assert.match(gate, /laptopStart \? laptop\.setupHow : laptop\.setupBody\) :/, "the setup screen");
  assert.equal(LAPTOP_LOCK.setupHow, "Approve with Touch\u00a0ID or Windows\u00a0Hello.", "a name never splits over two lines");
  assert.doesNotMatch(LAPTOP_LOCK.setupHow, /key/, "the heading already says second key");
  assert.match(LAPTOP_START.what, /second key/);
});

test("item 3: the phone's place is named as the phone names it (Your account, Devices, Add my laptop)", () => {
  assert.match(LAPTOP_START.next, /ZeroFee, Your account, Devices, Add my laptop\.$/);
  assert.match(LAPTOP_START.pairOn, /ZeroFee, Your account, Devices, Add my laptop\.$/);
  const sec = read("../apps/security/SecurityApp.tsx");
  assert.match(sec, /<NavRow title="Devices"/, "control: the row is Devices");
  assert.match(sec, /<span>Add my laptop<\/span>/, "control: its button");
});
