// Typing a backup word on the words screens (Recovery.tsx's RestoreWords): what Enter takes, what it says when it isn't
// one, and "did you mean". On its own, with the 2,048 words, so the recovery wait's words (recovery-words.ts, read by
// Home's freeze banner) never bring the list into Home's first load (speed budget, 5 Nov).
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** Said when Enter is pressed on what isn't a backup word (the review's brief, 4 Nov). */
export const NOT_A_WORD = "That isn't a backup word. Check the spelling.";
/** What Enter (or space) takes: the word typed when it is one, or the one word its letters start; never a guess. */
export function enteredWord(typed: string): string | null {
  const starts = typed ? wordlist.filter((w) => w.startsWith(typed)) : [];
  return starts.includes(typed) ? typed : starts.length === 1 ? starts[0]! : null;
}

const BACKUP_WORDS = new Set(wordlist);

/** Letters apart (insert, delete, change, swap two side by side), stopping early past `most`. */
function apart(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "Did you mean" for a word that isn't on the list (grade 02g, F21: "searchx" in red, no suggestion): the closest
 *  backup words, at most two letters apart, closest first. Nothing for a word on the list. */
export function closeWords(w: string, max = 3): string[] {
  if (w.length < 3 || BACKUP_WORDS.has(w)) return [];
  return wordlist
    .map((x) => [x, apart(w, x, 2)] as const)
    .filter(([, n]) => n <= 2)
    .sort((a, b) => a[1] - b[1])
    .slice(0, max)
    .map(([x]) => x);
}
