// Check before Agent pays: allow, warn or block, for one recipient. A small first version, kept pure so "Check before
// you pay" on every money sheet (the 5 Nov job) reuses it: a block list, and a warning the first time someone is paid.
// A block never reaches Agent's key; a warning is one line, and Agent then asks the person instead of paying alone.
//
// Not the contract's job: the account contract still holds Agent to its daily limit and the Face ID band whatever this
// says. This stops a prompt-injected Agent before it spends any of that limit.

export type Verdict = "allow" | "warn" | "block";
export interface Check {
  verdict: Verdict;
  /** One plain line for the screen (grade 5), naming the recipient. */
  line: string;
}

/**
 * Accounts and addresses ZeroFee's Agent never pays: known drainers and look-alikes. Matched whole and lower-cased, and
 * also as a suffix (a sub-account of a blocked NEAR account is blocked). Short on purpose: the full list is the 5 Nov job.
 */
export const BLOCK_LIST: readonly string[] = [
  "drainer.near",
  "claim-airdrop.near",
  "near-support.near",
  "wallet-verify.near",
  "0x000000000000000000000000000000000000dead",
];

/** The recipient as it is compared: trimmed, lower-cased. */
export const recipientKey = (to: string) => to.trim().toLowerCase();

/** Is `to` on the block list (or a sub-account of a blocked NEAR account)? */
export function isBlocked(to: string, list: readonly string[] = BLOCK_LIST): boolean {
  const k = recipientKey(to);
  return list.some((b) => k === b || (b.endsWith(".near") && k.endsWith(`.${b}`)));
}

/** A short name for the screen: a NEAR name stays whole, a long address is chunked. */
export function shortName(to: string): string {
  const t = to.trim();
  return t.length > 24 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t;
}

/**
 * The check. `paidBefore`: recipients this account has paid before (its own Activity, lower-cased). Block wins over
 * everything; then a first-time recipient warns; else allow.
 */
export function checkRecipient(to: string, paidBefore: ReadonlySet<string>, list: readonly string[] = BLOCK_LIST): Check {
  const name = shortName(to);
  if (!to.trim()) return { verdict: "block", line: "There's no one to pay." };
  if (isBlocked(to, list)) return { verdict: "block", line: `${name} is on the block list. AgentZero never pays it.` };
  if (!paidBefore.has(recipientKey(to))) return { verdict: "warn", line: `First time paying ${name}.` };
  return { verdict: "allow", line: `You've paid ${name} before.` };
}
