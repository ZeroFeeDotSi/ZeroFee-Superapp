// Finding 36 (sample-page crawl, 4 Nov): the backup word check took unlimited guesses on the same four choices, so a bot
// passed all three checks without the words. Now a wrong pick moves to a new word, and a second one stops the check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKS, pickWord, startCheck, type CheckState, type Rand } from "./word-check.ts";

/** 24 made-up words (never a real backup list in the tree). */
const WORDS = Array.from({ length: 24 }, (_, i) => `w${String.fromCharCode(97 + i)}${i}`);

/** A seeded randomness, so each run is the same. */
const seeded = (seed: number): Rand => {
  let x = seed >>> 0 || 1;
  return (n) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
};

/** Taps with `choose` until the check passes or stops; at most 20 taps. */
function run(choose: (s: CheckState) => string, rand: Rand) {
  let s = startCheck(WORDS, rand);
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    seen.push(`${s.now.pos}:${s.now.options.join(",")}`);
    const r = pickWord(s, WORDS, choose(s), rand);
    if (r.done) return { passed: true, done: r.done, state: r.state, seen };
    s = r.state;
    if (s.stopped) return { passed: false, state: s, seen };
  }
  return { passed: false, state: s, seen };
}

test("finding 36: a person with the words passes, with three different words in order", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = run((s) => s.now.right, seeded(seed));
    assert.ok(r.passed && r.done, `seed ${seed}`);
    assert.equal(r.done.positions.length, CHECKS);
    assert.equal(new Set(r.done.positions).size, CHECKS);
    assert.deepEqual(r.done.positions, [...r.done.positions].sort((a, b) => a - b));
    assert.deepEqual(r.done.picked, r.done.positions.map((p) => WORDS[p - 1]));
  }
});

test("finding 36: tapping the first choice every time can't pass (a lucky try is rare, and never the norm)", () => {
  let passes = 0;
  const tries = 4000;
  for (let seed = 1; seed <= tries; seed++) if (run((s) => s.now.options[0]!, seeded(seed)).passed) passes++;
  // Three right in at most four taps with one miss: (1/4)^3 + 3·(3/4)·(1/4)^3 ≈ 5 %. Before: 100 % (the same four came back).
  assert.ok(passes / tries < 0.08, `passed ${passes} of ${tries}`);
  // Control, the old bug's way: try each choice in turn. It can't, because a wrong pick never shows the same four again.
  let inTurn = 0;
  for (let seed = 1; seed <= tries; seed++) {
    let tried: string[] = [];
    let last = -1;
    const r = run((s) => {
      if (s.now.pos !== last) { tried = []; last = s.now.pos; }
      const w = s.now.options.find((o) => !tried.includes(o))!;
      tried.push(w);
      return w;
    }, seeded(seed));
    if (r.passed) inTurn++;
  }
  assert.ok(inTurn / tries < 0.08, `in turn passed ${inTurn} of ${tries}`);
});

test("finding 36: a wrong pick fails that word; a new word comes with new choices; the second wrong pick stops the check", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = seeded(seed);
    const s0 = startCheck(WORDS, rand);
    const wrong = s0.now.options.find((o) => o !== s0.now.right)!;
    const r1 = pickWord(s0, WORDS, wrong, rand);
    assert.equal(r1.done, undefined);
    assert.equal(r1.state.stopped, false);
    assert.equal(r1.state.missed, true);
    assert.notEqual(r1.state.now.pos, s0.now.pos, "never the same word again");
    assert.ok(!s0.asked.includes(r1.state.now.pos));
    assert.equal(r1.state.passed.length, 0, "the missed word doesn't count");
    const wrong2 = r1.state.now.options.find((o) => o !== r1.state.now.right)!;
    const r2 = pickWord(r1.state, WORDS, wrong2, rand);
    assert.equal(r2.state.stopped, true);
    assert.equal(r2.done, undefined);
    // stopped: no tap passes, not even the right word
    const r3 = pickWord(r2.state, WORDS, r2.state.now.right, rand);
    assert.equal(r3.done, undefined);
    assert.equal(r3.state.stopped, true);
  }
  // the four choices are four different words, one of them right
  const s = startCheck(WORDS, seeded(7));
  assert.equal(new Set(s.now.options).size, 4);
  assert.ok(s.now.options.includes(s.now.right));
});

test("finding 36: the screen and the phone use the new check; no word is ever retried on the same four", () => {
  const web = readFileSync(new URL("./WordCheck.tsx", import.meta.url), "utf8");
  const check = web.slice(web.indexOf("export function Check("));
  assert.match(readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8"), /export const Check = later<[^\n]*import\("\.\/WordCheck\.tsx"\)/, "set-up's Check is the lazy one");
  assert.match(check, /startCheck\(words\)/);
  assert.match(check, /pickWord\(s, words, w\)/);
  assert.match(check, /if \(s\.stopped\)/);
  assert.doesNotMatch(check, /setMiss|useMemo/, "the old retry-in-place state is gone");
  const ios = readFileSync(new URL("../../../ios/ZeroFee/WordsSheet.swift", import.meta.url), "utf8");
  assert.match(ios, /if misses > 1 \{ stopped = true; return \}/, "the phone stops after the second wrong pick");
  assert.match(ios, /filter\(\{ !asked\.contains\(\$0\) \}\)/, "the phone never asks a word twice");
  assert.match(ios, /Button \{ startCheck\(\); checking = true \}/, "a fresh check each time it opens");
  assert.doesNotMatch(ios, /guard w == r\.right else \{ miss = w; return \}/, "control: the old retry-in-place is gone");
});
