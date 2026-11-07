// the audit's way-home audit P5 (7 Nov): the way home's Check this said its figure twice ("Move $33.86 from Private to your
// Safe" over "Your Safe gets $33.86"), that row was firm though the core holds the Safe only to 98 % (pocket-moves.ts
// AT_LEAST_PERCENT, float-floors POCKET_HOME_LEAST_PERCENT), it had no Fee row (J2-2), and "Private keeps the rest ·
// about $13.86" was an exact ledger difference said "about". Now its rows, worked in whole cents once, add up: From
// Private = the least the Safe gets + the most it costs. Pure: a table test.
import { POCKET_HOME_LEAST_PERCENT } from "@zerofee/core/float-floors";

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The rows for `usd` (the plan's dollars, as its head said it): From, the Safe's about and least, the most it costs. */
export function homeRows(usd: number): { from: string; gets: string; fee: string } {
  const c = Math.round(usd * 100);
  // the least the Safe gets, rounded down to the cent (never above the core's own floor)
  const least = Math.floor((c * Number(POCKET_HOME_LEAST_PERCENT)) / 100);
  return { from: $(c), gets: `about ${$(c)}, at least ${$(least)}`, fee: `at most ${$(c - least)}` };
}
