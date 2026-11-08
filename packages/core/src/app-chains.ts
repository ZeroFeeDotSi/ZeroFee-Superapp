// The chains the app shows in V1 (product decision, 8 Nov). One list: a
// chain not on it has no wallet row on Hot, no line under Hot's total, no row in Details, no chip in Trade's Receive and
// no place in Move. Its data stays where it is (the ledger, the engine, the kept copy): nothing is deleted. Adding a chain
// later is one entry here.
export const APP_CHAINS = ["sol", "near", "hood"] as const;
export type AppChain = (typeof APP_CHAINS)[number];
/** Is `chain` one the app shows now? */
export const appChain = (chain: string): chain is AppChain => (APP_CHAINS as readonly string[]).includes(chain);
