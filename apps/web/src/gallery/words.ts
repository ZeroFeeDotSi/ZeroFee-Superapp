// The web demo account's 24 backup words. Every one is a backup-word-list word (the screens accept only those), and
// together they fail the list's checksum, so no wallet anywhere opens them (words.test.ts).
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const WORDS = "orbit velvet canyon pulse harbor lemon quick tiger ribbon sketch nature amount glove civil drift onion phrase metal brave crisp slogan window empty lunar".split(" ");

/**
 * The Sim's backup words after `round` sets of new words (QA sd-security (a): Get new words showed the same 24). Round 0
 * is WORDS; each later round is its own 24 list words, the same every time it's asked (a reload shows the same set), never
 * a valid phrase (the checksum fails, as WORDS'), and never a round before it.
 */
export function sampleWords(round: number): string[] {
  if (!(round > 0)) return WORDS;
  let seed = (Math.floor(round) * 2654435761) >>> 0;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (;;) {
    const words = Array.from({ length: 24 }, () => wordlist[next() % wordlist.length]);
    if (!validateMnemonic(words.join(" "), wordlist) && words.join(" ") !== WORDS.join(" ")) return words;
  }
}
