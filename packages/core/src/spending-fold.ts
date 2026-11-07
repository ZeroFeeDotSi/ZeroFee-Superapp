// Activity's one-move-one-row rule, on its own (no Spending service code), so Wallet's and Trade's Activity read it
// without loading the engine.
import type { SpendingActivity } from "./spending.ts";

/** One move, one row (QA, 3 Nov e2e walk: a Move showed as "Topped up $10.00" and "Moved $9.70 to Solana"): a leg folds
 *  into its move's row when that row is in the list; each leg is kept whole in `legs`, never dropped or counted twice. A
 *  leg whose move isn't in the list stays its own row. */
export function foldLegs(rows: readonly SpendingActivity[]): SpendingActivity[] {
  // a row folds only into a row that is itself no leg (so a chain of legs never hides a whole move)
  const ids = new Set(rows.map((r) => r.id));
  const top = new Set(rows.filter((r) => !(r.of && r.of !== r.id && ids.has(r.of))).map((r) => r.id));
  // only a leg that went or is going folds: one that failed, came back, was refused or waits stays its own row, with its
  // own mark and words (security review of c840c517, High: a failed leg folded under a Done move read as on its way)
  const folds = (r: SpendingActivity) => !!r.of && r.of !== r.id && top.has(r.of) && (r.status === "done" || r.status === "on-its-way");
  const legsOf = new Map<string, SpendingActivity[]>();
  for (const r of rows) if (folds(r)) legsOf.set(r.of!, [...(legsOf.get(r.of!) ?? []), r]);
  return rows.filter((r) => !folds(r)).map((r) => (legsOf.has(r.id) ? { ...r, legs: legsOf.get(r.id)! } : r));
}
/** Every row again, each leg its own (the Statement keeps every leg as its own line). */
export const unfoldLegs = (rows: readonly SpendingActivity[]): SpendingActivity[] => rows.flatMap(({ legs, ...r }) => [r, ...(legs ?? [])]);
/** What a move landed, in the coin it landed as (the audit's Send audit M5, 7 Nov): its own row's amountOut, else, for a row of
 *  legs, its one leg's (a Swap from the Safe lands on its leg on); done rows only, never a guess. Pure. */
export function landedOf(r: Pick<SpendingActivity, "status" | "amountOut" | "legs">): { amount: string; symbol: string } | undefined {
  if (r.status !== "done") return undefined;
  if (r.amountOut) return r.amountOut;
  const legs = r.legs ?? [];
  return legs.length === 1 && legs[0]!.status === "done" ? legs[0]!.amountOut : undefined;
}
