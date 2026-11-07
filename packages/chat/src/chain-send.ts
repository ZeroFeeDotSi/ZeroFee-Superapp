// Which chains ZeroFee Chat can offer a payment on. A payment always opens the money sheet and goes through NEAR
// Confidential, never a public send from a chain wallet (D85; subwallet.send is shut).

/** The core's answers that mean "not from the chain wallet": Chat opens the Safe's Send instead. */
export const NOT_FROM_CHAIN_WALLET = new Set(["security.balance.low-coin", "security.subwallet.unknown", "security.subwallet.chain"]);

/** Where Wallet's Send can pay out from Chat today (send-reach.ts): not Bitcoin, Zcash or Monero (their line says so). */
export const chatCanSendOn = (chain: string): boolean => !["btc", "zec", "xmr"].includes(chain);
