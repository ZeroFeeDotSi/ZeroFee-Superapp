// The sheet's "Amount:" line (grade 02g, G11) and the core's `amountSaid` (a Move's split block, QA's Sim re-check: one
// amount, said once). the audit's condition (5 Nov): the line goes only while a line of the sheet itself says the signed
// amount's dollars ("From your Safe · $40.00", or "Your Safe adds $40.00 to Private first."); a flag alone never hides
// it. The web sheet reads this; the phone's SheetWords.swift does the same check.
import type { PlainWords } from "./signer.ts";
import { titleMoney } from "./format.ts";

/** Audit 10's A5 (8 Nov): the title already says the amount ("Send $5.00 (1.1286 NEAR) through NEAR Confidential" over
 *  "Amount: about $5.00 (1.1286 NEAR)": the figure twice, exact then "about"). Then the title is where it is said, once. */
const titleSays = (w: { title?: string; amount?: string }): string | null => {
  const money = titleMoney(w.amount);
  return money && w.title?.includes(money) ? money : null;
};
/** The sheet's title as drawn: an estimate ("about $5.00 (…)") says "about" in the title, since no Amount line follows. */
export function sheetTitle(w: { title: string; amount?: string }): string {
  const money = titleSays(w);
  if (!money || !/^about /.test(w.amount ?? "") || w.title.includes(`about ${money}`)) return w.title;
  return w.title.replace(money, `about ${money}`);
}

/** The "Amount:" line's text, or null when it is not drawn. */
export function amountLine(w: Pick<PlainWords, "amount" | "amountSaid" | "lines"> & { title?: string }): string | null {
  if (!w.amount) return null;
  if (titleSays(w)) return null;
  if (w.amountSaid !== true) return w.amount;
  // a priced coin's Amount is "about $30.00 (6.7731 NEAR)": its dollars are the same figure a line says (QA's ledger
  // re-walk, 6 Nov: a NEAR Send's fill sheet said it twice), the "about" is the price's, never a different sum
  const dollars = w.amount.split(" (")[0]!.trim().replace(/^about /, "");
  const said = /^\$[\d,]+\.\d{2}$/.test(dollars) && w.lines.some((l) => l.includes(`· ${dollars}`) || l.includes(` ${dollars} `));
  return said ? null : w.amount;
}
