// Swap's refusal said on its own sheet (rule 8, Sim walk 5 Nov, row S2): what
// failed, by its own words; where the money is, by the wallet's name; the one tap (the line's button) after it.
import type { Problem } from "@zerofee/core/problem";
import { problemLine } from "@zerofee/core/services";

/** "Another job is using this money. Nothing moved. Your money is in your Safe." The where is added only when the
 *  refusal's own words don't already say where the money is (never said twice). */
export function stoppedLine(p: Problem): string {
  return /\bYour money\b|\bstill in your\b/i.test(p.whatHappened) ? p.whatHappened : problemLine(p);
}
