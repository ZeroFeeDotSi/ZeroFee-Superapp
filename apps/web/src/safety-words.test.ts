// H49 and H15: the one case nobody can undo is said where the words are written down (web and the phone's own screen)
// and in Recovery; changing Face ID is warned about before the key is made and before Settings opens.
// Product decision, 2 Nov: the words screen shows at most two one-line notes; every fact behind them is one tap down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_LOST_WORDS, HOT_SHORT, RENEW_WORDS_COPY, WORDS_COPY, WORDS_MORE, allLostWords, lostShort, renewWordsCopy, wordsCopy } from "./words-copy.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const words = (s: string) => s.replace(/[.,:]/g, "").split(/\s+/).filter(Boolean).length;

test("the words screens say it once: phone, words and second device lost, nobody can bring the money back, not even ZeroFee", () => {
  // a browser (this test) says "this device", never "phone" (D17, grade 1 Nov c, P8); the phone says its own
  assert.equal(ALL_LOST_WORDS, "If you lose this device, your words and your second device, nobody can bring your money back. Not even ZeroFee.");
  assert.equal(allLostWords(true), "If you lose your phone, your words and your second device, nobody can bring your money back. Not even ZeroFee.");
  // the note says it in one line; the full sentence is one tap down, on both screens
  assert.equal(lostShort(true), "Lose phone, words and second device: money gone.");
  assert.ok(WORDS_COPY.notes.includes(lostShort()));
  assert.ok(WORDS_COPY.more.includes(ALL_LOST_WORDS) && RENEW_WORDS_COPY.more.includes(ALL_LOST_WORDS));
  assert.match(read("apps/web/src/screens/Onboarding.tsx"), /t\.notes\.map[\s\S]*<More label=\{WORDS_MORE\} lines=\{t\.more\}/);
  const swift = read("apps/ios/ZeroFee/WordsSheet.swift");
  assert.ok(swift.includes(allLostWords(true)) && swift.includes(lostShort(true)), "the phone's own words screen says the same");
  assert.match(read("apps/web/src/apps/security/SecurityApp.tsx"), /\{ALL_LOST_WORDS\}/, "and Recovery");
});

test("the words screen: at most two notes, each one short line (product decision, 2 Nov), and every fact still true one tap down", () => {
  for (const copy of [WORDS_COPY, RENEW_WORDS_COPY]) {
    assert.ok(copy.notes.length <= 2, "at most two notes");
    // the words' reach is said in full (design review, 5 Nov): every other note stays one short line
    for (const n of copy.notes) if (n !== HOT_SHORT) assert.ok(words(n) <= 9, `one short line: "${n}"`);
  }
  assert.equal(WORDS_MORE, "What these words can do");
  // D43: anyone with the words can take Hot and Private at once and can try for the Safe, said on the screen itself
  assert.equal(HOT_SHORT, "Anyone with these words can take everything in Hot and Private at once, and can try to take your Safe. Your phone gets its recovery wait to stop them.");
  assert.ok(WORDS_COPY.notes.includes(HOT_SHORT) && RENEW_WORDS_COPY.notes.includes(HOT_SHORT));
  // D44: the Safe only after the wait, which this device can stop; Spending at once; big amounts in the Safe
  assert.match(WORDS_COPY.more[0], /^Your Safe: they can only add a new device after a wait\. This device can stop it\.$/);
  assert.match(WORDS_COPY.more[1], /^Hot and Private: they open them at once\. They don't open your Safe\.$/);
  assert.match(RENEW_WORDS_COPY.more.join(" "), /old words keep working until these take over/);
});

test("the backup words, in the one name for the money", () => {
  assert.equal(WORDS_COPY.title, "Write these down");
  assert.equal(WORDS_COPY.sub, "24 words, in order, on paper. Never a photo.");
  // one name for the money, from one constant (grade 1 Nov, item 6): never "vault" while it says "Safe"
  assert.doesNotMatch(JSON.stringify([WORDS_COPY, RENEW_WORDS_COPY]), /vault|balance/);
});

test("changing Face ID is warned about before the key is made and before Settings", () => {
  assert.match(read("apps/web/src/screens/Onboarding.tsx"), /Changing Face ID stops this key\./);
  assert.match(read("apps/web/src/shell/FaceIdRow.tsx"), /stops your key on this iPhone for good/);
});

test("the words' note says the account's own recovery wait, read from recovery.status, never a figure written in the copy (design review, 5 Nov)", () => {
  const line = (d?: number) => wordsCopy(d).notes[0];
  assert.equal(line(172_800), "Anyone with these words can take everything in Hot and Private at once, and can try to take your Safe. Your phone gets 48 hours to stop them.");
  // control: the line changes when the account's delay changes
  assert.equal(line(7 * 86_400), "Anyone with these words can take everything in Hot and Private at once, and can try to take your Safe. Your phone gets 7 days to stop them.");
  assert.notEqual(line(172_800), line(7 * 86_400));
  assert.match(renewWordsCopy(3 * 86_400).notes[1], /Your phone gets 3 days to stop them\.$/);
  // unread: no figure at all
  assert.doesNotMatch(line(), /\d/);
});
