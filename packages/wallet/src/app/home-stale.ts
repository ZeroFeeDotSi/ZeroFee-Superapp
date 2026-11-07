// Home's reads started early (home-keep.ts kickEarly) are stale once the page itself changes the money they read: the audit's
// MUST on A2-3 (8 Nov). The core announces a Safe move (ledger.balancesChanged), but making a site's wallet emits nothing
// Home hears on the real core, so whoever makes the wallets (browser/social/prepare.ts) says so here. One mark per page
// (the page has one account; the wallets are made on Social's bridge, Home reads on Wallet's). A file of its own so the
// caller doesn't load home-keep.ts (Home's speed budget).
let epoch = 0;
/** Home's early reads, if any, are stale: the next Home reads afresh. */
export const staleEarly = (): void => { epoch += 1; };
/** The mark early reads carry, to compare when Home takes them. */
export const earlyEpoch = (): number => epoch;
