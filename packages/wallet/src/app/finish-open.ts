// A Problem's "open" step that reopens an action's own money sheet (wallet-problems finishScreen; the audit's C2, 7 Nov: a held
// first step ran and the rest wasn't sent, so Finish the move asks again on that action's normal sheet, a new Face ID).
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";

/** The sheet a "money/…" screen opens, from the Safe; null: not one of these. */
export function finishOpen(screen: string): MoneyAsk | null {
  if (screen === "money/send") return { kind: "send", wallet: "safe" };
  if (screen === "money/swap") return { kind: "swap", wallet: "safe" };
  if (screen === "money/move") return { kind: "move", wallet: "safe", from: "safe" };
  return null;
}
