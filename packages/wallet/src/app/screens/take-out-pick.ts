/** A take-out's first amount: $10, or the row's whole dollars when it holds less (e2e walk 3 Nov: it started at All, as
 *  Move's put-in starts at $10); "All" is one tap away. */
export const firstPick = (rowUsd: number): number => Math.min(10, Math.floor(rowUsd));
