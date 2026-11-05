import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { WORDS, sampleWords } from "./words.ts";

test("the web demo's backup words: 24 list words the screens accept, failing the checksum so no wallet opens them", () => {
  assert.equal(WORDS.length, 24);
  assert.deepEqual(WORDS.filter((w) => !wordlist.includes(w)), [], "every word is on the list, so Check my words can pass");
  assert.equal(validateMnemonic(WORDS.join(" "), wordlist), false, "the checksum fails: no wallet will import them");
  assert.equal(validateMnemonic("abandon ".repeat(11) + "about", wordlist), true, "control: the checker passes a valid phrase");
});

test("the Sim's new words (QA sd-security (a)): each round its own 24 list words, never an earlier round's, never a valid phrase", () => {
  assert.deepEqual(sampleWords(0), WORDS, "control: round 0 is the account's own");
  const rounds = [1, 2, 3, 4, 5].map(sampleWords);
  const all = [WORDS, ...rounds].map((w) => w.join(" "));
  assert.equal(new Set(all).size, all.length, "new words differ from every set before them");
  for (const w of rounds) {
    assert.equal(w.length, 24);
    assert.deepEqual(w.filter((x) => !wordlist.includes(x)), []);
    assert.equal(validateMnemonic(w.join(" "), wordlist), false);
  }
  assert.deepEqual(sampleWords(2), rounds[1], "the same round is the same words (a reload shows the same set)");
});

test("public repo (audit ruling, 5 Nov): the sample phrase in this file and every Sim round 1-20 fail the checksum, so none is a wallet", () => {
  assert.equal(validateMnemonic(WORDS.join(" "), wordlist), false, "the sample phrase is not a wallet anyone can open");
  for (let round = 1; round <= 20; round++) assert.equal(validateMnemonic(sampleWords(round).join(" "), wordlist), false, `round ${round}`);
});
