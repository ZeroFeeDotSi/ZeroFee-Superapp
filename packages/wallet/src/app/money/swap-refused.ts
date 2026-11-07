// Swap's refusal said on its own sheet (rule 8, Sim walk 5 Nov, row S2): what
// failed, by its own words; where the money is, by the wallet's name; the one tap (the line's button) after it.
import type { NextStep, Problem } from "@zerofee/core/problem";
import { problemLine, serviceOf } from "@zerofee/core/services";
import { refusalFace, refusalText } from "@zerofee/shell-api/refusal-face.ts";

/** A swap's Problem the sheet says itself, with its own Try again: one whose one step is Try again and that names no
 *  service (a service's is the sheet's line, services.ts sheetLineOf). A money call's plain throw has no Try again (core money-calls.ts). Never the shell's screen behind the sheet
 *  (QA, 4 Nov: "Solana's price isn't read yet" sat there 4 minutes, one more copy per hold). */
export const saidOnSheet = (p: Problem): boolean => p.next.kind === "retry" && !serviceOf(p);
/** A Send refused with money that may already have left: its one step is Activity (wallet-problems pocketPartWent, core sendPartly). */
export const sendEndsHere = (p: Problem): boolean => p.next.kind === "open" && p.next.screen === "activity";
/** Such a refusal on Move or Swap, as on Send: the shell's screen, then the sheet closes, so its lit button can't pay again; its pill goes to Activity. */
export async function endHere(shell: { showProblem(p: Problem): Promise<NextStep>; openApp(app: never, tab?: string): void }, p: Problem, close: () => void): Promise<void> {
  const next = await shell.showProblem(p);
  close();
  if (next.kind === "open") shell.openApp("wallet" as never, next.screen);
}

/** The where is added only when the refusal's own words don't already say where the money is (never said twice). The busy
 *  refusal is the UI reviewer's sentence as it stands (6 Nov): "nothing moved" is its where. */
export function stoppedLine(p: Problem): string {
  // a wallet's refusal (copy review, 7 Nov): its own reason as the head, the money fact after it
  const f = refusalFace(p);
  if (f) return refusalText(f);
  return p.code === "shell.job.taken" || /\bYour money\b|\bstill in your\b/i.test(p.whatHappened) ? p.whatHappened : problemLine(p);
}
