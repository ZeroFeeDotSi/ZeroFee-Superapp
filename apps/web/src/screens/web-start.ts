// The web wallet's start (product decision, 4 Nov: like Phantom, NO Safe). Create: 24 new words, shown once, then checked;
// I already have one: 24 typed words. Either way the words go on to the core (account.web.import), which keeps them
// sealed under the password and makes the three wallets from them.
//
// The words are chosen before the password exists (the order: words, check, then the password), so until the lock is
// made they wait here, in this page's memory only: never in storage, never in the address; a reload drops them. The App
// takes them once (takeWebWords), right after the lock opens.
import { seedToWords, wordsProblem } from "@zerofee/core/recovery-words";

// The words held until the lock, and the start screen's words, are in web-words-held.ts (the App takes them in Home's
// first load, without the word list: speed budget, 5 Nov).
export { WEB_START, keepWebWords, takeWebWords } from "./web-words-held.ts";

/** 24 new words from 32 random bytes (the bytes are zeroed once the words are made). */
export function newWebWords(): string[] {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  try {
    return seedToWords(seed);
  } finally {
    seed.fill(0);
  }
}

/** Typed words, checked before they go anywhere: which word to fix, or the whole set is wrong, or null (good). */
export function typedWordsBack(words: readonly string[]): { badWord: number } | { wrong: true } | null {
  const p = wordsProblem(words);
  if (!p) return null;
  return p.kind === "unknown-word" ? { badWord: p.position } : { wrong: true };
}
