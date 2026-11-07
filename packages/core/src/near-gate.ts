// The NEAR coin wallet's few constants and its gate, apart from near-trade.ts so the core's first load carries only these
// (Home's JS budget): the trade's building, checking and signing load with the first NEAR coin call (subwallets.ts).

export const REF_EXCHANGE_ID = "v2.ref-finance.near";
export const WNEAR = "wrap.near";
/** A coin account's storage, the most a register may attach: 0.00125 NEAR, what wrap.near, RHEA, BLACKDRAGON, NPRO and
 *  USDt all ask (storage_balance_bounds read on mainnet, 3 Nov; review M2: never 0.01 to any contract). */
export const NEAR_STORAGE_MAX_YOCTO = 1_250_000_000_000_000_000_000n;
/** The most a coin contract's own storage step may attach (0.01 NEAR): the wallet's cap on a coin's storage_balance_bounds
 *  min (moves.ts registerOn) and the core's on a deposit address's step (intents.ts targetStorage, 83, 6 Nov): with
 *  registration_only true, NEP-145 refunds anything over the contract's min to the signer. One copy. */
export const STORAGE_DEPOSIT_MAX_YOCTO = 10_000_000_000_000_000_000_000n;
/**
 * The core's own gate on NEAR coin trades and the NEAR coin wallet's moves (review, 3 Nov): shut on every phone until the
 * the operator's real-money rounds pass; only the test runner opens it, in its own process (--open-near), as
 * Trade's MARKET has no NEAR. Shut: every subwallet.near.* trade and the wallet's Make ready and Put away are refused.
 */
/** Audit pass 2, item 6a: the gate was a plain mutable object, so any script holding the module could open it. Now it
 *  is frozen, and `open` can be set only in a Node process (the test runner, tests); in the app (browser, the iPhone's
 *  JavaScriptCore: no `process`) setting it throws and the gate stays shut. */
export const gateSettable = (g: { process?: { versions?: { node?: unknown } }; window?: unknown }): boolean =>
  typeof g.process?.versions?.node === "string" && g.window === undefined;
let nearOpen = false;
export const NEAR_GATE: { open: boolean } = Object.freeze({
  get open() {
    return nearOpen;
  },
  set open(v: boolean) {
    if (!gateSettable(globalThis as never)) throw new Error("The NEAR gate can't change in the app.");
    nearOpen = v === true;
  },
});
/** Trade's own line for the same fact (trade runtime NEAR_NOT_TRADED): never a promise with no date (gates grade). */
export const NEAR_CLOSED = "Trade doesn't buy or sell NEAR coins.";
/** The NEAR coin wallet's name (3 Nov, Rhea trades): public, apart from "your NEAR wallet" (Spending's cash, D129). */
export const NEAR_COIN_WALLET = "NEAR coin wallet";
