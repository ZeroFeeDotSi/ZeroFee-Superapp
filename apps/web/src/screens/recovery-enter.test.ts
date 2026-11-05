// a web test, 4 Nov (item 5): in "Bring back my wallet", a non-word + Enter silently filled the first suggestion ("zzzz" ->
// "buzz"). Enter now takes only a word on the list, or the one word its letters start; anything else says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_A_WORD, enteredWord } from "./word-entry.ts";

test("recovery Enter: a non-word is never swapped for a guess", () => {
  assert.equal(enteredWord("zzzz"), null);
  assert.equal(enteredWord("ab"), null, "many words start ab: no single answer, no guess");
  assert.equal(enteredWord(""), null);
  assert.equal(NOT_A_WORD, "That isn't a backup word. Check the spelling.");
});

test("recovery Enter: control: a whole word, or letters only one word starts, is taken", () => {
  assert.equal(enteredWord("buzz"), "buzz");
  assert.equal(enteredWord("act"), "act", "a whole word wins over the longer ones it starts (action, actor…)");
  assert.equal(enteredWord("zoo"), "zoo");
  assert.equal(enteredWord("abando"), "abandon");
  assert.equal(enteredWord("buz"), "buzz", "only buzz starts buz");
});

test("recovery Enter: the key handler uses enteredWord and says NOT_A_WORD, never suggestions[0]", () => {
  const src = readFileSync(new URL("./Recovery.tsx", import.meta.url), "utf8");
  const key = src.slice(src.indexOf("onKeyDown={(e) => {"), src.indexOf("autoCapitalize="));
  assert.match(key, /const w = enteredWord\(current\);\n\s+if \(w\) accept\(w\); else setNotWord\(!!current\);/);
  assert.doesNotMatch(key, /suggestions\[0\]/, "control: the old first-suggestion fill is gone");
  assert.match(src, /\{notWord && <p className="zf-small" role="alert">\{NOT_A_WORD\}<\/p>\}/);
  assert.match(src, /const onChange = \(raw: string\) => \{\n    setNotWord\(false\);/, "typing again clears the line");
});

test("restore crawl (4 Nov): the counter counts backup words only, never a wrong word in its slot; 24 typed with one wrong says check (control: real words count)", () => {
  const src = readFileSync(new URL("./Recovery.tsx", import.meta.url), "utf8");
  assert.match(src, /const filled = words\.filter\(\(w\) => KNOWN\.has\(w\)\)\.length;/);
  assert.doesNotMatch(src, /const filled = words\.filter\(Boolean\)\.length;/, "control: the old count of anything typed");
  assert.match(src, /\{!typedAll \? `\$\{filled\} of 24` : !allKnown \? "Check the words in red"/);
  // what the count does on a slot with "zzzz" and one with "buzz": only buzz counts
  const known = new Set(["buzz"]);
  assert.equal(["buzz", "zzzz", ""].filter((w) => known.has(w)).length, 1);
});
