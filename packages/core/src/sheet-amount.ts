// The sheet's "Amount:" line (grade 02g, G11) and the core's `amountSaid` (a Move's split block, QA's Sim re-check: one
// amount, said once). the audit's condition (5 Nov): the line goes only while a line of the sheet itself says the signed
// amount's dollars ("From your Safe · $40.00", or "Your Safe adds $40.00 to Private first."); a flag alone never hides
// it. The web sheet reads this; the phone's SheetWords.swift does the same check.
import type { PlainWords } from "./signer.ts";

/** The "Amount:" line's text, or null when it is not drawn. */
export function amountLine(w: Pick<PlainWords, "amount" | "amountSaid" | "lines">): string | null {
  if (!w.amount) return null;
  if (w.amountSaid !== true) return w.amount;
  // a priced coin's Amount is "about $30.00 (6.7731 NEAR)": its dollars are the same figure a line says (QA's ledger
  // re-walk, 6 Nov: a NEAR Send's fill sheet said it twice), the "about" is the price's, never a different sum
  const dollars = w.amount.split(" (")[0]!.trim().replace(/^about /, "");
  const said = /^\$[\d,]+\.\d{2}$/.test(dollars) && w.lines.some((l) => l.includes(`· ${dollars}`) || l.includes(` ${dollars} `));
  return said ? null : w.amount;
}
