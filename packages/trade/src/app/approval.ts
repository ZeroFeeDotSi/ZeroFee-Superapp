// Trade's lines that name the approval, said truthfully for where ZeroFee runs (D20): "Face ID" in the iPhone app,
// "Approve" in a browser. The words come from the shell's approvalWords(); no screen of Trade hard-codes "Face ID".
// D143 (product decision, 3 Nov): Face ID only when money leaves the Safe. A trade, a NEAR wallet swap and a move between the NEAR
// wallet and the chain wallets sign with no Face ID; the core signs what its checks pass and refuses the rest, named.
import { approvalWords, type ApprovalWords } from "@zerofee/shell-api/approval-words.ts";
import type { Asks } from "../service.ts";

export { approvalWords, type ApprovalWords };

/** The first letter lower-cased, for words inside a line ("No Face ID" -> "no Face ID", "Nothing to approve" -> "nothing to approve"). */
export const inLine = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The line under the Buy / Sell pill: nothing asks (D143). A trade the core won't sign says so before the tap. */
export function faceLine(asks: Asks | undefined, w: ApprovalWords = approvalWords()): string {
  if (asks === "always") return "ZeroFee can't check this trade, so it won't go";
  if (asks === "wide") return "Its price can move a lot, so this sale won't go";
  return w.none;
}

/** How trades sign (D143): no Face ID; ZeroFee's checks are the gate. */
export const sessionLine = (w: ApprovalWords = approvalWords()): string => `Trades go ${w.without}. ZeroFee checks each one first.`;
/** How money in your wallets is spent (AddTakeOut.tsx). */
export const spentLine = (w: ApprovalWords = approvalWords()): string => `Trades from your wallets go ${w.without}. ZeroFee checks each one first.`;
/** The fee guard's line on the NEAR wallet's moves, said only when it's close: past it a move waits a day (money back to
 *  the Safe still goes). */
export const movesLeftLine = (left: number): string =>
  left === 0 ? "No more moves today. Money can still go back to your Safe." : `${left} more move${left === 1 ? "" : "s"} today`;
/** Home's two rows: Add ("One Face ID" / "One approval": money leaves the Safe) and Take out ("no Face ID" / "nothing to approve"). */
export const addRowLine = (w: ApprovalWords = approvalWords()): string => `${w.one[0]!.toUpperCase()}${w.one.slice(1)} · lands in about a minute`;
export const takeOutRowLine = (w: ApprovalWords = approvalWords()): string => `Your NEAR wallet's cash goes back to your Safe · ${inLine(w.none)}`;
