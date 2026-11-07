// Where a Spending row paid from Private came from (J3): one pure rule for the job page (live-steps privateMoney) and
// Activity's From line (statement.ts spendingEnds), so the two never disagree.
import type { SpendingActivity } from "@zerofee/core/spending";
import { receiptPrivate } from "@zerofee/shell-api/job-start.ts";

/** Where a Move paid from Private came from (J3, the copy review's walk and the audit's MUST, 7 Nov: a $10 Swap Private paid whole said
 *  "From Safe"): Private once the ledger's payments are known and none is the Safe's fill ("safe-send:"); the Safe's fill
 *  among them, or the payments not known yet (the Safe may still be asked): the Safe, as before. Pure: a table test. */
export function paidFrom(r: Pick<SpendingActivity, "fill" | "paid">): string[] {
  const paid = r.paid ?? [];
  return !r.fill && paid.length > 0 && !paid.some((id) => id.startsWith("safe-send:")) ? ["private"] : ["safe"];
}

/** A Swap receipt's "From Private, so no Face ID." (the copy review's J2-4, 8 Nov: it showed while the Safe paid): only when the job's
 *  own record says Private paid (paidFrom), on a Safe route the fill rule said the Safe signs nothing (receiptPrivate);
 *  no record yet, a fill, or the Safe's own payment: none. Pure: a table test. */
export const receiptPaidLine = (safeRoute: boolean, signs: boolean | undefined, row: Pick<SpendingActivity, "fill" | "paid"> | null | undefined): string | null =>
  row && paidFrom(row)[0] === "private" ? receiptPrivate(safeRoute, signs) : null;
