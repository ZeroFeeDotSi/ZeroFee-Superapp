// The code a sending wallet scans to send an exact amount to a deposit address (Pay's "Add 2.00 USDC on Base"):
// EIP-681 on the Ethereum-style networks whose chain id is pinned here, Solana Pay on Solana. Anything else, or anything
// that doesn't check out, is null: the screen shows the plain address code and asks for the amount in words.
import { fromUnits, toUnits } from "./amount.ts";

/** Each network's own chain id (EIP-155), pinned. A network not listed gets the plain address: never a guessed id. */
const EVM_CHAIN_ID: Record<string, number> = { eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, bsc: 56, gnosis: 100, avax: 43114 };
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * `contract`: the coin's token contract (an ERC-20, an SPL mint), null for the network's own coin. `amount`: a decimal
 * in that coin, already at least the bridge's minimum.
 */
export function payCode(o: { chain: string; address: string; contract: string | null; decimals: number; amount: string }): string | null {
  const units = toUnits(o.amount, o.decimals);
  if (units === null || units <= 0n) return null;
  const chainId = EVM_CHAIN_ID[o.chain];
  if (chainId !== undefined) {
    if (!EVM_ADDRESS.test(o.address)) return null;
    if (o.contract === null) return `ethereum:${o.address}@${chainId}?value=${units}`;
    if (!EVM_ADDRESS.test(o.contract)) return null;
    return `ethereum:${o.contract}@${chainId}/transfer?address=${o.address}&uint256=${units}`;
  }
  if (o.chain === "sol") {
    if (!SOLANA_ADDRESS.test(o.address) || (o.contract !== null && !SOLANA_ADDRESS.test(o.contract))) return null;
    return `solana:${o.address}?amount=${fromUnits(units, o.decimals)}${o.contract ? `&spl-token=${o.contract}` : ""}`;
  }
  return null;
}
