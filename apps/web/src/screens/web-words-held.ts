// The web wallet's words, held in this page's memory from the start screen until the lock is made (web-start.ts has the
// rest: making and checking words, with the word list). On its own so the App takes them in Home's first load without
// the list (speed budget, 5 Nov).

/** The web wallet's start screen's words (WebStart.tsx), and the App's while it makes the wallet. */
export const WEB_START = {
  sub: "A wallet in your browser. ZeroFee never holds your words.",
  create: "Create my wallet",
  have: "I already have one",
  making: "Your wallet is being made by ZeroFee. About 2 s.",
} as const;

let waiting: string[] | null = null;
/** The words kept were made here (Create my wallet), not typed: a new wallet, empty for sure. */
let madeHere = false;

export const keepWebWords = (words: string[], made = false): void => {
  waiting = [...words];
  madeHere = made;
};

/** The words chosen before the lock, once: a second call gets null. */
export function takeWebWords(): { words: string[]; made: boolean } | null {
  const w = waiting;
  waiting = null;
  return w ? { words: w, made: madeHere } : null;
}
