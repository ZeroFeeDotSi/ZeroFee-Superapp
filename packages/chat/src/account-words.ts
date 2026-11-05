// A NEAR account as people read it, with no imports of its own, so any screen can say it without loading Chat (names.ts
// re-exports both; Home's Details says the Sim's account as Chat does).

/** The public Sim's one account (MockBridge PUBLIC_SAMPLE_ACCOUNT_ID): dotless and short, so no NEAR account can have it
 *  (such names are the registrar's alone) and nothing paid to it lands anywhere. Only the Sim's bridge ever says it is yours. */
export const SIM_ACCOUNT = "zf-account";

/** A NEAR account as Chat writes it: whole (L4: zf-… names are short, and shortening makes look-alikes cheap), except a
 *  64-hex implicit account, shortened in the middle to 8…8 hex, 64 bits a forger would have to match (diff review M-C). */
export function accountWords(account: string): string {
  // sd-chat crawl (5 Nov, f): the Sim's own account, "zf-account", read as machine text; it is "Sample account"
  if (account === SIM_ACCOUNT) return "Sample account";
  return /^[0-9a-f]{64}$/.test(account) ? `${account.slice(0, 8)}…${account.slice(-8)}` : account;
}
