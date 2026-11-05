// Security's Quantum-safe card and sheet (review, 5 Nov). The truth is the account's own key list, as
// NEAR lists it (AccountInfo.keys, read by account.state from chain.accessKeys): a post-quantum key is listed by its
// "ml-dsa-65-hash:…" handle, a classical key as itself ("ed25519:…"). Never a hard-coded On. Nothing here speaks of
// connections (the relay and the nodes are not checked).
//
// Judged (the build's correction): only the keys that can move the Safe's money: a phone, the backup words, a second device,
// and any full-access key. A session or trading key (role "session": a function-call key outside every role) is
// classical on purpose and the contract's role gates refuse it every method, so it is listed for what it is and never
// turns the card Off. AgentZero's key has its own row and is never judged or removed here (its off switch is AgentZero's).
//
// On an account with rules (audit, 5 Nov): a FULL-ACCESS key of any kind, quantum-safe or not, bypasses the contract
// entirely, so it is never called just "old": it reads red, "This key can bypass your Safe's rules." Its Remove is offered
// only when the contract's remove_key can take it (an ML-DSA-65 key, not this device's own: lib.rs remove_key refuses a
// classical key and the signer's own). A classical function-call leftover there can't move the Safe's money and the
// contract can't remove it, so it reads "Old key · can't move your Safe's money" with no Remove (rule 1: never a Remove
// that can't work).
import type { AccountKeyInfo } from "@zerofee/core/signer";

/** The test, on the one field NEAR gives: the key's handle. */
export const isQuantumSafe = (k: Pick<AccountKeyInfo, "handle">): boolean => k.handle.startsWith("ml-dsa-65");

/** A key that can move the Safe's money (so it decides On). */
export const movesMoney = (k: AccountKeyInfo): boolean =>
  k.role === "device" || k.role === "recovery" || k.role === "second-device" || (k.access === "full" && k.role !== "agent");

export type QuantumRowId = "phone" | "laptop" | "words" | "agent";
export interface QuantumRow { id: QuantumRowId; label: string; line?: string; safe: boolean }
/** An old (classical) key that moves money, and its one fix: removed (a leftover key, behind the guarded RemoveKey's
 *  confirm), new words (a classical backup-words key), pairing again (a classical laptop), or none (this device's own). */
export type OldFix = "remove" | "new-words" | "pair-again" | "none" | "other-device";
export interface OldKey { handle: string; role: AccountKeyInfo["role"]; fix: OldFix }
/** A full-access key on an account with rules: it bypasses the contract. `remove` only when remove_key can take it. */
export interface BypassKey { handle: string; remove: boolean }
export interface Quantum {
  /** Every key that can move the Safe's money is ML-DSA-65 (and there is at least one), and no key bypasses the rules. */
  on: boolean;
  /** One row each: ticked only when that key is on the account and is ML-DSA-65; else "Not yet". */
  rows: QuantumRow[];
  old: OldKey[];
  /** Session keys (classical by design): listed, never judged. */
  sessions: string[];
  /** Rules accounts only: full-access keys, red, first. */
  bypass: BypassKey[];
  /** Rules accounts only: classical function-call leftovers the contract can't remove; they can't move the Safe's money. */
  leftovers: string[];
}

export const QUANTUM_WORDS = {
  title: "Quantum-safe",
  rowLine: "Your Safe's keys",
  on: "On",
  /** "to remove" only when every old key really has a Remove; "to replace" when none does; "to fix" for a mix. */
  oldCount: (old: readonly Pick<OldKey, "fix">[]) => {
    const n = old.length, removes = old.filter((k) => k.fix === "remove").length;
    const verb = removes === n ? "remove" : removes === 0 ? "replace" : "fix";
    return n === 1 ? `One old key to ${verb}` : `${n} old keys to ${verb}`;
  },
  fix: "Fix",
  headOn: "Your Safe is quantum-safe",
  lineOn: "Its keys use the new standard made to resist quantum computers.",
  lineOld: "Its other keys use the new standard made to resist quantum computers. An old key can be broken by future computers.",
  notYet: "Not yet",
  oldRow: "An older kind of key",
  oldLine: "Future computers could break it.",
  oldWords: "Your backup words",
  oldWordsLine: "An older kind of key. New words replace it.",
  oldLaptop: "Your laptop",
  oldLaptopLine: "An older kind of key. Pairing again replaces it.",
  otherDevice: "Another device's key",
  otherDeviceLine: "Replace it from that device",
  oldThisDevice: "This device's key. Move to a new phone to change it.",
  bypassRow: "Full-access key",
  bypassLine: "This key can bypass your Safe's rules.",
  bypassHead: (n: number) => (n === 1 ? "One key can bypass your rules" : `${n} keys can bypass your rules`),
  leftoverRow: "Old key",
  leftoverLine: "Can't move your Safe's money",
  remove: "Remove",
  newWords: "Make new words",
  pairAgain: "Pair it again",
  session: "Trade permission",
  sessionLine: "Can't move your Safe's money",
  confirmTitle: "Remove a key",
  confirmHead: "Remove the old full-access key?",
  confirmHeadBypass: "Remove the full-access key?",
  confirmLine: "Nothing of yours stops working.",
  confirmWait: (wait: string | null) => (wait ? `It waits ${wait} before it's gone. You can cancel it until then.` : "If your rules make it wait, you'll see for how long, and you can cancel it until then."),
  confirmGo: "Remove the key",
  confirmNo: "Not now",
  trade: "Only your Safe is quantum-safe. Your trade wallets and Private use their chains' own keys, as safe as each chain allows.",
  signUp: "Your Safe is quantum-safe from the start.",
} as const;

/** the audit (5 Nov, rule 1): can the account's own remove path take this key? On an account with rules it goes through the
 *  contract's remove_key, which refuses a classical key (lib.rs: ML-DSA-65 only), so no Remove is offered for one. */
export const canRemoveKey = (k: Pick<AccountKeyInfo, "handle">, rules: boolean): boolean => !rules || isQuantumSafe(k);
/** The honest line beside another device's key, the card's own words: a full-access key on rules bypasses them; a
 *  classical one there can't be removed here, only replaced from that device. Null: nothing to add. */
export const otherKeyLine = (k: Pick<AccountKeyInfo, "handle" | "access">, rules: boolean): string | null =>
  rules && k.access === "full" ? QUANTUM_WORDS.bypassLine : canRemoveKey(k, rules) ? null : QUANTUM_WORDS.otherDeviceLine;

const fixOf = (k: AccountKeyInfo): OldFix =>
  k.role === "recovery" ? "new-words" : k.role === "second-device" ? "pair-again" : k.role === "device" ? (k.current ? "none" : "other-device") : "remove";

/** The card and the sheet, from the key list. `phoneWord`: "This phone" on the phone, "This device" elsewhere. */
/** `rules`: the account contract is on the account (AccountInfo.rules). */
export function quantumOf(keys: readonly AccountKeyInfo[], phoneWord = "This phone", rules = false): Quantum {
  const safe = (pick: (k: AccountKeyInfo) => boolean) => keys.some((k) => pick(k) && isQuantumSafe(k));
  const mine = (k: AccountKeyInfo) => k.role === "device" && k.current === true;
  const chip = keys.some((k) => mine(k) && k.kind === "secure-chip");
  const rows: QuantumRow[] = [
    { id: "phone", label: phoneWord, ...(chip ? { line: "In its secure chip" } : {}), safe: safe(mine) },
    { id: "laptop", label: "Your laptop", safe: safe((k) => k.role === "second-device") },
    { id: "words", label: "Your backup words", safe: safe((k) => k.role === "recovery") },
    { id: "agent", label: "AgentZero", safe: safe((k) => k.role === "agent") },
  ];
  const full = (k: AccountKeyInfo) => rules && k.access === "full";
  const bypass = keys.filter(full).map((k) => ({ handle: k.handle, remove: isQuantumSafe(k) && k.current !== true }));
  // A role-less classical key's fix is "remove"; on rules it is a leftover the contract can't remove (function-call only).
  const leftover = (k: AccountKeyInfo) => rules && k.access !== "full" && !isQuantumSafe(k) && k.role === undefined;
  const leftovers = keys.filter(leftover).map((k) => k.handle);
  const judged = keys.filter((k) => movesMoney(k) || leftover(k));
  const old = judged.filter((k) => !isQuantumSafe(k) && !full(k) && !leftover(k)).map((k) => ({ handle: k.handle, role: k.role, fix: fixOf(k) }));
  const sessions = keys.filter((k) => k.role === "session" && k.access !== "full").map((k) => k.handle);
  return { on: judged.length > 0 && old.length === 0 && bypass.length === 0, rows, old, sessions, bypass, leftovers };
}
