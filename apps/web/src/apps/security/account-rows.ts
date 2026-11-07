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
  /** the backup words' check is due */
  checkDue: boolean;
}
export interface AccountRowWords { quantum: string; protection: string; recovery: { line?: string; value: string } }

export const ACCOUNT_ROW_WORDS = {
  /** the copy review's S3: Protection's right side on the web (the Safe's rules, which this browser only shows) */
  yourRules: "Your rules",
  /** the copy review's S3 and #7: Recovery's right side, on the phone and the web (the wait lives on Recovery itself) */
  backupWords: "Backup words",
} as const;

export function accountRowWords(f: AccountRowFacts): AccountRowWords {
  const quantum = f.quantumOn === null ? "" : f.quantumOn ? (f.web ? QUANTUM_WORDS.onIphone : QUANTUM_WORDS.on) : QUANTUM_WORDS.fix;
  const protection = f.protection === null ? "" : f.protection ? (f.web ? ACCOUNT_ROW_WORDS.yourRules : "On") : "Add";
  const recovery = f.pending ? { line: "A new device is waiting", value: "Stop it" } : f.checkDue ? { line: "Check your backup words", value: "Check" } : { value: ACCOUNT_ROW_WORDS.backupWords };
  return { quantum, protection, recovery };
}
