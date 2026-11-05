// D115 (product decision, 3 Nov, for release): set-up offers only the chains ZeroFee trades on (NEAR, Solana, Robinhood Chain; BNB
// once it opens) and their dollar coins there; every other coin stays behind this switch, off, for the first update.
// The switch alone, in its own file: Home's ledger reads it, and fund-start.ts (7.6 KB: set-up's coins and steps) stays
// out of Home's first load on every path (the bundler's chunking put it there or not depending on the folder's path).
// D155 (product decision, 3 Nov): every chain NEAR Intents supports opens an account, the private way. On in the test
// proof build (VITE_HOME_PROOF=1, a test phone and laptop), as Home's other money paths, so it proves each chain with dust;
// public builds stay on NEAR, SOL and ETH (RH) until each has passed.
import { HOME_PROOF } from "./home-proof.ts";
export const FUND_EVERY_CHAIN: boolean = HOME_PROOF;
