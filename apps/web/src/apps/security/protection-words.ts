// Protection's own lines (design review 2 Nov §3), kept apart from the screen so the tests can read them in node.
import { endsWords } from "../../screens/countdown.ts";

/** Protection's one line under its name (§3.2). k-security crawl (4 Nov, S4): "NEAR contract" was jargon; the
 *  Copywriter's line (VOICE line 110): the account keeps the rules, the Safe is where the money lives. */
export const INTRO = "Your NEAR account keeps these rules. Only you can change them.";

/** A held change to these rules, as the one row above them (§3.7): "Your new rules start at 9:57 AM ›". */
export function pendingRow(p: { readyAtIso: string; ready: boolean; needsSecondDevice: boolean }, now = new Date()): string {
  if (p.needsSecondDevice) return "Your new rules need your second device's yes";
  if (p.ready || Date.parse(p.readyAtIso) <= now.getTime()) return "Your new rules are ready. Finish them";
  const ends = endsWords(p.readyAtIso, now);
  return ends ? `Your new rules start ${ends.includes(",") ? "" : "at "}${ends}` : "Your new rules are waiting";
}
