// The Settings drawer's words (UI's robot pass F5): the account's name as the person wrote it, never the raw account
// id (zf-sample000001.testnet is an address, not a name); a footer in plain words; "Forget this device" in one sheet.
export const ACCOUNT_NAME_KEY = "account-name";
export const ACCOUNT_NAME_MAX = 40;

/** The name shown at the top of Settings: what the person saved, else a plain word, never the account id. `web`: the
 *  web wallet says "wallet" (its lock's words, UnlockGate WEB_LOCK). */
export function accountNameShown(saved: string | null | undefined, web = false): string {
  const name = cleanAccountName(saved);
  return name || (web ? "Your NEAR account" : "Your account");
}

/** The address under the name (a web test, 4 Nov: the web wallet showed all 64 hex characters): a NEAR address that is
 *  64 hex characters shows its first 6 and last 4; a named one (the phone's) as it is. Copy still copies all of it. */
export function shortAddress(id: string): string {
  return /^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** A name as it's kept: one line, trimmed, at most ACCOUNT_NAME_MAX characters; empty when there's nothing to keep. */
export function cleanAccountName(typed: string | null | undefined): string {
  return String(typed ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ACCOUNT_NAME_MAX);
}

/** The footer, true per network (grade 01d Q5): the version on mainnet and in the demo; on the test network, that it
 *  moves test money (it does send it), never "nothing is sent". */
export function footerWords(mainnet: boolean, webDemo = false): string {
  return mainnet || webDemo ? "Version 0.1" : "Test network · test money";
}

/** What the row and its sheet are called: what it does, sites lose sight of the wallet, never "Forget this device"
 *  (which read as wiping the phone; grade 1 Nov, item 8). */
export const DISCONNECT_SITES = "Disconnect all sites";
/** The one sheet for it: what happens, whether money is involved, one next step. */
export function forgetWords(sites: number): { title: string; body: string; money: string; button: string } {
  const what = sites === 0 ? "No site can see your wallet from this device." : sites === 1 ? "The one site that sees your wallet stops seeing it." : `The ${sites} sites that see your wallet stop seeing it.`;
  return { title: DISCONNECT_SITES, body: sites === 0 ? what : `${what} Each one asks again the next time you use it.`, money: "Your money stays in your Safe. Your key stays on this device.", button: sites === 0 ? "Close" : "Disconnect" };
}

/** The public web build's mode switch (Copywriter, 3 Nov): "Money", Sim | Real, and one line for the mode it is in. */
export const MONEY_LABEL = "Money";
export const SIM_LINE = "Pretend money. Nothing real moves.";
export const REAL_LINE = "Your real account. Use tiny amounts only.";
export const moneyLine = (sim: boolean): string => (sim ? SIM_LINE : REAL_LINE);
