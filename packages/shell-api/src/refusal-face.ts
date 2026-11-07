// the copy review's rule (7 Nov) for a refusal on the Move and Swap sheets and the Problem screen: the head is who and why, one
// sentence; the body is the money fact; the button is the way on. A wallet's refusal (security.subwallet.refused) says
// its own reason (`more`, "ZeroFee couldn't read Private, so it stopped this. Nothing moved."): its first sentence is the
// head, the rest the body. With no plain reason of its own, the head is "ZeroFee said no." and the rest the body. Pure.
import type { Problem } from "@zerofee/core/problem";

/** Machine text (UI-SIMPLICITY-RULES rule 3): a coin id, raw units, a 0x… id, a 64-hex hash, a number over 12 digits.
 *  Never a head; on the Problem screen it sits behind "Details for ZeroFee" (VOICE §1.6). */
const MACHINE = [/\bnep\d{3}:/, /\.omft\.near/, /units of/, /0x[0-9a-fA-F]{40,}/, /\b[0-9a-fA-F]{64}\b/, /\d{13,}/];
export const machineText = (s: string): boolean => MACHINE.some((re) => re.test(s));

/** A wallet's refusal as its head and body; null for any other Problem (its own words stand). */
export function refusalFace(p: Problem): { head: string; body: string } | null {
  if (p.code !== "security.subwallet.refused") return null;
  const where = p.money.state === "safe" ? `Your money is ${p.money.where}.` : "";
  // the generic one's body (provisional, to 53): "This wallet can't approve this. Your money is in that wallet."
  const m = p.more && !machineText(p.more) ? /^(.*?[.!?])\s*(.*)$/s.exec(p.more.trim()) : null;
  return m ? { head: m[1]!, body: m[2] || where } : { head: "ZeroFee said no.", body: `This wallet can't approve this. ${where}`.trim() };
}

/** The sheets' one line: the head, then the body. */
export const refusalText = (f: { head: string; body: string }): string => `${f.head} ${f.body}`.trim();
/** A Jobs row's stop words for a Problem (the audit's way-home audit M9, 7 Nov): a wallet's refusal by its own reason, head then
 *  body (the words the Problem screen shows), never its generic "This wallet can't approve this"; any other its own. */
export const refusalWords = (p: Problem): string => { const f = refusalFace(p); return f ? refusalText(f) : p.whatHappened; };
