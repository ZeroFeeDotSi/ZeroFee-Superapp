// Home's Send FROM a wallet (the Home plan §1.3, D124, D128): your SOL wallet and your ETH (RH) wallet, each its own wallet
// on its own chain. Every Send from one goes privately through NEAR (ledger.hiddenFromRow: the wallet's coin into NEAR's
// private balance, then on to any address on any chain Send reaches, changed to that chain's coin on the way). D143: the
// hold is the act, with no Approve (a wallet's key never asks). There is no plain send from Home (D128).
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Balance } from "../../types.ts";

/** The wallets Send can send from today, by chain: their name on Home, their coin, and the room kept for the network's fee
 *  (the core's own: Solana's fee and the account's minimum, HIDDEN_ROW_SOL_ROOM; Robinhood Chain's transfer at the most
 *  ZeroFee pays there, FEE_CAPS). Max never asks for that room. */
export const SEND_ROWS = {
  sol: { name: "SOL wallet", coin: "SOL", symbol: "SOL", icon: "sol", network: "Solana", room: 0.001, decimals: 9 },
  hood: { name: "ETH (RH) wallet", coin: "ETH (RH)", symbol: "ETH", icon: "eth", network: "Robinhood Chain", room: 0.0001, decimals: 18 },
} as const;
export type SendRowChain = keyof typeof SEND_ROWS;

/** A Home wallet (its own wallet on its chain), not a coin of the Safe. */
export const isRow = (b: Pick<Balance, "tokenId">): boolean => b.tokenId.startsWith("row:");
export const rowChain = (b: Pick<Balance, "tokenId">): SendRowChain | null => {
  const c = b.tokenId.slice(4);
  return isRow(b) && (c === "sol" || c === "hood") ? c : null;
};

/** The wallets as coins for the picker: the coin's amount and dollars as Spending reads them; none unread or empty. */
export function rowCoins(s: SpendingStatus | null): Balance[] {
  if (!s || !s.loaded || s.unread) return [];
  return s.networks.flatMap((n) => {
    const r = n.network === "sol" || n.network === "hood" ? SEND_ROWS[n.network] : null;
    if (!r || n.closed || !n.nativeAmount || !(Number(n.nativeAmount) > 0)) return [];
    return [{ tokenId: `row:${n.network}`, symbol: r.symbol, name: r.name, icon: r.icon, chain: n.network, amount: n.nativeAmount, usd: n.cashUsd, bridged: false, held: "account" as const, listed: true }];
  });
}

/** The most a wallet can send: all of it but its fee room, never below zero, in its coin (as text, 9 places at most). */
export function rowMax(row: SendRowChain, amount: string): string {
  const left = Number(amount) - SEND_ROWS[row].room;
  if (!(left > 0)) return "0";
  return (Math.floor(left * 1e9) / 1e9).toFixed(9).replace(/\.?0+$/, "");
}

export const isEvmAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

/** Each network's own coin: "SOL" on Solana needs no "on Solana"; any other coin there does ("USDC on Solana"). */
const OWN_COIN: Record<string, string> = { near: "NEAR", sol: "SOL", eth: "ETH", btc: "BTC", bsc: "BNB", doge: "DOGE", ltc: "LTC", xrp: "XRP", tron: "TRX", ton: "TON", zec: "ZEC", bch: "BCH", sui: "SUI", aptos: "APT", avax: "AVAX", stellar: "XLM" };

/**
 * A coin's name in a picker, so no two read the same (3 Nov e2e walk, 30/51: four "USDC" and two "NEAR" with no
 * network): a wallet by its Home name ("SOL wallet"); a Safe coin by its network ("USDC on Solana", "USDC on NEAR"; a
 * network's own coin alone: "SOL", "BTC"); a coin on the NEAR account itself, not yet in NEAR Intents, as the coin page
 * says it ("USDC on your account").
 */
export function coinLabel(b: Pick<Balance, "tokenId" | "symbol" | "name" | "chain" | "held">, networkName: (chain: string) => string): string {
  if (isRow(b)) return b.name;
  if (b.held === "account") return `${b.symbol} on your account`;
  return OWN_COIN[b.chain] === b.symbol ? b.symbol : `${b.symbol} on ${networkName(b.chain)}`;
}
