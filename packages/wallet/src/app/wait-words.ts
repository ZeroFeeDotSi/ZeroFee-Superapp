// Builder 22's item 1 (8 Nov): the wallet's own waits said "Opening…", "Reading your activity…" with an ellipsis and no
// one doing it. Each says who and one clock, as the shell's set-up lines do (apps/web/src/screens/setup-words.ts).
export const WAIT_WORDS = {
  /** A screen's code loads (later.tsx / Suspense fallback): tens of ms, a second at most. */
  opening: "This screen opens now. About 1 s.",
  /** Details' wallets list loads. */
  wallets: "ZeroFee reads your wallets now. About 1 s.",
  /** Add money's chain list is read. */
  networks: "ZeroFee reads the chains you can add from. About 1 s.",
} as const;
