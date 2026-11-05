// A payment ZeroFee Chat can make from the person's chain wallet (D55: Trade, Apps and Chat share one wallet per chain)
// with subwallet.send, rather than the Safe's Send: the chain's own coin on a network that has a chain wallet. The core
// builds the transfer, refuses it before any sheet when the wallet doesn't hold enough (Chat then opens the Safe's Send),
// and always shows its sheet.

/** Each chain wallet's own coin, by the network names Chat uses (detect.ts). */
const OWN_COIN: Record<string, string> = { sol: "SOL", bsc: "BNB", hood: "ETH", eth: "ETH", base: "ETH", arb: "ETH", gnosis: "XDAI" };

/** The subwallet.send this payment would be, or null when it can only go through the Safe's Send. */
export function chainWalletSend(p: { chain: string; address: string; amount?: string; coin?: string }): { chain: string; to: string; amount: string } | null {
  const own = OWN_COIN[p.chain];
  if (!own || !p.amount || !p.coin || p.coin.toUpperCase() !== own) return null;
  if (!/^\d{1,30}(\.\d{1,18})?$/.test(p.amount) || Number(p.amount) <= 0) return null;
  return { chain: p.chain, to: p.address, amount: p.amount };
}

/** The core's answers that mean "not from the chain wallet": Chat opens the Safe's Send instead. */
export const NOT_FROM_CHAIN_WALLET = new Set(["security.balance.low-coin", "security.subwallet.unknown", "security.subwallet.chain"]);

/** Where Wallet's Send can pay out from Chat today (send-reach.ts): not Bitcoin, Zcash or Monero (their line says so). */
export const chatCanSendOn = (chain: string): boolean => !["btc", "zec", "xmr"].includes(chain);
