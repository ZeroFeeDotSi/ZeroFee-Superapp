// One rule for which of a site's wallets count (QA's test, MUST 9: Home said "GMGN / 2 wallets" while GMGN's
// page showed one). Home's site row (wallet safe-hot.ts siteGroups), the site's page (browser site-wallet.ts walletView)
// and its wallet line (hub-state.ts fundedLine) all count and list a site's wallets by this.

/** A site wallet with money in it: its dollars, read, at a cent or more; its dollars not read or not priced, an amount
 *  ("0.0012 ETH") that isn't zero. An empty wallet ZeroFee made for the site is no wallet on screen. */
export const siteWalletFunded = (usd: number | null, holds?: string): boolean => (usd !== null ? usd >= 0.01 : !!holds && /[1-9]/.test(holds.split(" ")[0] ?? ""));
