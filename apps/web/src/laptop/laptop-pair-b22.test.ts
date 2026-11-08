// Builder 22's item 7 (8 Nov; audit 17 S16-3, b20's laptop-b20 fixed the path line): the laptop's pairing screen named
// the phone two ways ("Scan this with your main device" over "On your phone: ZeroFee, Your account, Devices, Add my
// laptop.") and named places the phone doesn't have ("the amount you choose there", "these letters"). Each line now
// names the phone as "your phone" and each place by the phone's own menu word (Protection, Letters to check, Or paste
// the code, Devices, Add my laptop). Fails on main: no LAPTOP_PAIR, the old lines are in Laptop.tsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAPTOP_PAIR, LAPTOP_START } from "../unlock/laptop-lock-words.ts";

function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, ""); return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length); };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("laptop-pair-b22: the pairing screen names the phone one way, at grade 5", () => {
  const lines = [LAPTOP_PAIR.scan, ...LAPTOP_PAIR.willDo, LAPTOP_PAIR.copy, LAPTOP_PAIR.letters, ...LAPTOP_PAIR.answers];
  for (const l of lines) {
    assert.doesNotMatch(l, /main device|second device|Security|…/, l);
    assert.ok(fkGrade(l) <= 5, `${fkGrade(l).toFixed(1)}: ${l}`);
  }
  // the path lines are the menu's own words in order (the brief's "ZeroFee, Your account, Devices, Add my laptop."), not
  // prose: no grade, but the same one name
  for (const l of [LAPTOP_START.pairOn, LAPTOP_START.next]) assert.doesNotMatch(l, /main device|second device|Security|…/, l);
  const page = read("./Laptop.tsx");
  for (const old of ["Scan this with your main device", "the amount you choose there", "paste it on your main device", "Your main device shows these letters", "What your main device asks"])
    assert.ok(!page.includes(old), `still on the page: ${old}`);
  for (const k of ["scan", "willDo", "copy", "letters", "answers"]) assert.ok(page.includes(`LAPTOP_PAIR.${k}`), k);
});

test("laptop-pair-b22: every place it names is a place the phone's menu has, by its word", () => {
  const sec = read("../apps/security/SecurityApp.tsx");
  // Your account's rows and the Devices sheet (the path LAPTOP_START.pairOn walks)
  assert.match(sec, /<NavRow title="Protection"/);
  assert.match(sec, /<NavRow title="Devices"/);
  assert.match(sec, /<span>Add my laptop<\/span>/);
  assert.equal(LAPTOP_START.pairOn, "On your phone: ZeroFee, Your account, Devices, Add my laptop.");
  assert.match(read("../shell/settings-words.ts"), /: "Your account"\)/, "the menu's head is Your account");
  // the laptop flow's own labels on the phone
  assert.match(sec, /<div className="zf-label">Letters to check<\/div>/);
  assert.match(sec, /"Or paste the code"/);
  assert.match(LAPTOP_PAIR.willDo[0], /Protection/);
  assert.match(LAPTOP_PAIR.letters, /Letters to check/);
});

test("laptop-pair-b22: the public build's laptop marker follows the new words", () => {
  assert.match(read("../../deploy-app.sh"), /for gone in "Or copy the code to paste on your phone"/);
});
