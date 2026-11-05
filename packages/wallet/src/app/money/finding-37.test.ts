// Finding 37 on Home's money pages: with $25 chosen by a chip (or Max), typing 1 gave $251. Send, Swap and a site's
// top-up now mark a chip, Max or a filled-in amount as picked, and the keypad types over a picked figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { padBase, press } from "@zerofee/design/keypad.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("the keypad types over a picked figure: $25 then 1 is 1 (control: a typed figure grows)", () => {
  assert.equal(press(padBase("25", true), "1", 2), "1");
  assert.equal(press(padBase("25", false), "1", 2), "251");
});

test("Send: chips, Max and an amount it was opened with are picked; a key clears the mark", () => {
  const s = src("./SendForm.tsx");
  assert.match(s, /onClick=\{\(\) => \{ setPreset\(true\); type\(d\); \}\}/, "a $ chip");
  assert.match(s, /onClick=\{\(\) => \{ setPreset\(true\); slide\(STEPS\); \}\} data-testid="send-max"/, "Max");
  assert.match(s, /setPreset\(true\);\s*type\(filled\.usd\)/, "dollars it was opened with");
  assert.match(s, /<Keypad value=\{padBase\(shown \|\| "0", preset\)\}[^>]*onChange=\{\(v\) => \{ setPreset\(false\);/);
  assert.ok(!/<Keypad value=\{shown \|\| "0"\}/.test(s), "control: the old keypad that appended is gone");
});

test("Swap: chips and Max are picked, and so is the amount it opened with", () => {
  const s = src("./SwapSheet.tsx");
  assert.match(s, /onClick=\{\(\) => \{ setPreset\(true\); onUsd\(d\); \}\}/);
  assert.match(s, /onClick=\{\(\) => \{ setPreset\(true\); onUsd\(most\.toFixed\(2\)\); \}\}/);
  assert.match(s, /useState\(!!prefill\?\.usd\)/);
  assert.match(s, /<Keypad value=\{padBase\(usd \|\| "0", preset\)\}[^>]*onChange=\{\(v\) => \{ setPreset\(false\);/);
});

test("a site's top-up: Max is typed over too (control: its keypad already started fresh)", () => {
  const s = src("./SiteMoney.tsx");
  assert.match(s, /onClick=\{\(\) => \{ setFresh\(true\); setUsd\(trimCents\(maxUsd\)\); \}\}/);
  assert.ok(!s.includes("setFresh(false); setUsd(trimCents(maxUsd))"));
  assert.match(s, /<Keypad value=\{fresh \? "" : usd\}/);
});
