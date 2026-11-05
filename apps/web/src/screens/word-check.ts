// The backup words' check (Words → Check): three words, each picked from four. It must prove the person wrote the words
// down (finding 36, 4 Nov: "Not that one" kept the same four choices, so the next tap passed; bots passed all three
// checks without the words, one by tapping the first choice every time). A wrong pick fails that word: a new word comes,
// with new choices, and the same four never come back. A second wrong pick stops the check: the person looks at the
// paper and starts again with new words. Pure, so it's tested in node (word-check.test.ts).

export const CHECKS = 3;
/** Wrong picks in one check before it stops. */
export const MISSES_ALLOWED = 1;

/** A wrong pick: said over the new word that replaces it. */
export const CHECK_MISSED = "Not that one. Here is a new word. Look at your paper.";
/** Two wrong picks: the check stops; it starts again, with new words, after the paper. */
export const CHECK_STOPPED = { title: "Look at your paper. Then try again.", line: "Two picks were wrong. The check starts again with new words." } as const;

export interface CheckRound { pos: number; right: string; options: string[] }
export interface CheckState {
  /** The words passed so far, in order. */
  passed: CheckRound[];
  /** The word being asked. */
  now: CheckRound;
  /** Positions already asked (passed or missed): never asked again in this check. */
  asked: number[];
  misses: number;
  /** The last pick was wrong (the screen says so over the new word). */
  missed: boolean;
  /** Too many wrong picks: the check is over; look at the paper and start again. */
  stopped: boolean;
}
export type CheckPick = { state: CheckState; done?: { positions: number[]; picked: string[] } };

/** A random whole number below `n` (the device's own randomness by default). */
export type Rand = (n: number) => number;
const cryptoRand: Rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;

export function shuffle<T>(a: readonly T[], rand: Rand = cryptoRand): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A word not asked yet, with three other words from the list (never the same word twice among the four). */
export function roundFor(words: readonly string[], asked: readonly number[], rand: Rand = cryptoRand): CheckRound {
  const free = words.map((_, i) => i + 1).filter((p) => !asked.includes(p));
  const pos = free[rand(free.length)]!;
  const right = words[pos - 1]!;
  const others = shuffle([...new Set(words.filter((w) => w !== right))], rand).slice(0, 3);
  return { pos, right, options: shuffle([right, ...others], rand) };
}

export function startCheck(words: readonly string[], rand: Rand = cryptoRand): CheckState {
  const now = roundFor(words, [], rand);
  return { passed: [], now, asked: [now.pos], misses: 0, missed: false, stopped: false };
}

/** One tap. Right: the next word, or done after three. Wrong: a new word (or, past the misses allowed, the check stops). */
export function pickWord(s: CheckState, words: readonly string[], picked: string, rand: Rand = cryptoRand): CheckPick {
  if (s.stopped) return { state: s };
  if (picked === s.now.right) {
    const passed = [...s.passed, s.now];
    if (passed.length >= CHECKS) {
      const order = [...passed].sort((a, b) => a.pos - b.pos);
      return { state: { ...s, passed, missed: false }, done: { positions: order.map((r) => r.pos), picked: order.map((r) => r.right) } };
    }
    const now = roundFor(words, s.asked, rand);
    return { state: { ...s, passed, now, asked: [...s.asked, now.pos], missed: false } };
  }
  const misses = s.misses + 1;
  if (misses > MISSES_ALLOWED) return { state: { ...s, misses, missed: true, stopped: true } };
  const now = roundFor(words, s.asked, rand);
  return { state: { ...s, now, asked: [...s.asked, now.pos], misses, missed: true } };
}
