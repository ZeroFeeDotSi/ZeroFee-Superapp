// What Your account's rows say on their right side (the copy review's S3 and #7, 7 Nov): never "On" for a state the web doesn't have.
// Only the words: what each row opens, and what any check decides, are unchanged. `web`: not inside the iPhone app.
import { QUANTUM_WORDS } from "./quantum.ts";

export interface AccountRowFacts {
  web: boolean;
  /** quantumOf(...).on, null while no key list is known */
  quantumOn: boolean | null;
  /** Protection's rules: true set, false none, null not read yet */
  protection: boolean | null;
  /** a move to a new phone is waiting */
  pending: boolean;
  /** the backup words' check is due; null: the core hasn't said yet (the audit's T14) */
  checkDue: boolean | null;
}
export interface AccountRowWords { quantum: string; protection: string; recovery: { line?: string; value: string } }

export const ACCOUNT_ROW_WORDS = {
  /** the copy review's S3: Protection's right side on the web (the Safe's rules, which this browser only shows) */
  yourRules: "Your rules",
  /** QA 16's S12 (8 Nov): Recovery's right side says a state, never the row's name ("Backup words"): the words checked
   *  ("Written down", only on the core's answer), due ("Check"), a move waiting ("Stop it"); not said yet: nothing */
  wordsDown: QUANTUM_WORDS.wordsDown,
} as const;

/** the audit's Trade audit T14 (8 Nov): Recovery's "Backup words · Written down" was ticked from the first frame, before the
 *  core said anything (and for good when that read failed). The tick comes only from the core's answer that the words
 *  were checked (the account is ready with no check due: re-typed, or confirmed); due says "Check them"; not said yet,
 *  nothing (never a tick, never a claim). */
export function backupWordsShown(checkDue: boolean | null): { value: string; tick: boolean } {
  if (checkDue === true) return { value: "Check them", tick: false };
  if (checkDue === false) return { value: QUANTUM_WORDS.wordsDown, tick: true };
  return { value: "", tick: false };
}
/** The Quantum sheet's `wordsChecked`: the words key is on the account and the core said they were checked. */
export const wordsCheckedOf = (hasWordsKey: boolean, checkDue: boolean | null): boolean | null => (checkDue === null ? null : hasWordsKey && !checkDue);

export function accountRowWords(f: AccountRowFacts): AccountRowWords {
  const quantum = f.quantumOn === null ? "" : f.quantumOn ? (f.web ? QUANTUM_WORDS.onIphone : QUANTUM_WORDS.on) : QUANTUM_WORDS.fix;
  const protection = f.protection === null ? "" : f.protection ? (f.web ? ACCOUNT_ROW_WORDS.yourRules : "On") : "Add";
  const recovery = f.pending ? { line: "A new device is waiting", value: "Stop it" } : f.checkDue === true ? { line: "Check your backup words", value: "Check" } : { value: f.checkDue === false ? ACCOUNT_ROW_WORDS.wordsDown : "" };
  return { quantum, protection, recovery };
}
