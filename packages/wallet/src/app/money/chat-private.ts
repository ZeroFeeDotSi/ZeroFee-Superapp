// D85 (product decision, 2 Nov): a send Chat asks for goes from Private, and only from Private.
// When Private is short it stops, never a silent public send from the Safe or a chain wallet: one line says by how much,
// with one tap to move money in. Where it goes, the amount lands where anyone can read it (a NEAR account, an address on
// its chain); who sent it doesn't: NEAR Intents settles it, not the person's account.
import type { Balance } from "../../types.ts";
import { EVM_CHAINS } from "../../addresses.ts";

/** What isn't hidden, where the other side is a public account or address (every Chat payee today). The old "your
 *  account isn't on the public chain" line is gone (privacy audit, 4 Nov): nothing used it, and the step in is public. */
export const OPEN_AMOUNT_LINE = "Anyone can see the amount when it lands.";
/** The one tap when Private is short. */
export const MOVE_TO_PRIVATE = "Move money to Private";
/** Private isn't set up on this device yet: the same one tap opens it, where Set up is the first button. */
export const SET_UP_PRIVATE = "Private isn't set up yet. Set it up, then move money in.";
/** Private can't pay this at all (a coin or route it doesn't hold): nothing moves. */
export const CANT_PRIVATE = "Private can't pay this one yet. Nothing moved.";

/** Room for the swap service's fee on a Private payment (its price is a little over what lands): 1%. */
export const FEE_ROOM = 1.01;

/** "Your Private balance is $3 short. Move money to Private first." (the dollars when known, rounded up to the cent). */
export function shortLine(shortUsd: number | null): string {
  if (shortUsd === null || !Number.isFinite(shortUsd) || shortUsd <= 0) return "Private is short. Move money to it first.";
  const cents = Math.ceil(shortUsd * 100) / 100;
  const said = cents >= 1 && Number.isInteger(cents) ? `$${cents}` : `$${cents.toFixed(2)}`;
  return `Private is ${said} short. Move money to it first.`;
}

/**
 * How many dollars Private is short for this send: the payment's dollars (its coin's price, or a dollar coin's own
 * amount) and room for the swap service's fee (FEE_ROOM), less what Private holds of that coin on that network (review
 * L3: USDC on NEAR doesn't pay USDC on Base). Null when the payment has no price (the line then names no figure).
 */
export function privateShortUsd(target: { amount: string; symbol: string; chain?: string; priceUsd?: string }, rows: readonly Pick<Balance, "symbol" | "amount" | "usd" | "chain">[]): number | null {
  const stable = /^USD[CT]$/i.test(target.symbol);
  const price = target.priceUsd !== undefined && Number.isFinite(Number(target.priceUsd)) ? Number(target.priceUsd) : stable ? 1 : null;
  const amount = Number(target.amount);
  if (price === null || !Number.isFinite(amount) || amount <= 0) return null;
  const need = amount * price * FEE_ROOM;
  const have = rows
    .filter((r) => r.symbol.toUpperCase() === target.symbol.toUpperCase() && (target.chain === undefined || r.chain === target.chain))
    .reduce((n, r) => n + (r.usd !== undefined && Number.isFinite(Number(r.usd)) ? Number(r.usd) : stable ? Number(r.amount) || 0 : (Number(r.amount) || 0) * price), 0);
  return Math.max(0, need - have);
}

/** May a confirm Chat asked for go ahead? Only a quote paid from Private (never the Safe's transfer, never "off"). */
export function privateOnly(c: { privacy?: { on: boolean }; quote?: unknown }): boolean {
  return c.privacy?.on === true && c.quote !== undefined && c.quote !== null;
}

// FLOW-V4 §1 Send (D70, D108, D111): Hidden is the default on every Send, Plain one tap away on the same sheet. A send
// Chat asks for opens on Hidden too (G5). Plain is only ever the person's own tap: never a silent fall-back (D85).
export type SendMode = "hidden" | "plain";
/** Every Send opens on Hidden: from Home, from a row, from Chat. */
export const FIRST_MODE: SendMode = "hidden";
/** The toggle's two words (D108: never "Private"). */
export const MODE_WORDS: Record<SendMode, string> = { hidden: "Private", plain: "Plain" };
/** Under the toggle on Plain: what the chain shows. */
export const PLAIN_LINE = "Plain sends it straight. Anyone can see it came from you.";
/** The one tap that turns a send Hidden can't carry to Plain. */
export const SEND_PLAIN = "Send it plain";
/** Hidden can't carry this coin or this chain today: say which, and offer Plain ("Hidden can't send DOGE yet. Send it plain?"). */
export function hiddenCantLine(symbol: string | undefined, network?: string): string {
  const coin = symbol && /^[A-Za-z0-9.]{1,12}$/.test(symbol) ? symbol.toUpperCase() : null;
  if (coin) return `Private can't send ${coin} yet. Send it plain?`;
  if (network && /^[A-Za-z0-9 ]{1,24}$/.test(network)) return `Private can't send to ${network} yet. Send it plain?`;
  return "Private can't send this yet. Send it plain?";
}
/** The Hidden answers that mean "this corridor isn't one Hidden carries" (not "too little in Hidden": that stops, D85). */
export function hiddenCantCarry(code: string): boolean {
  return /^(pay\.route\.none|pay\.code\.coin-unsupported)$/.test(code);
}
/** Networks whose addresses ZeroFee checks before it sends (wallet addresses.ts validAddress): Solana and the EVM ones. */
export const checksAddressOn = (chain: string | undefined): boolean => chain === "sol" || (chain !== undefined && EVM_CHAINS.has(chain));
/** A coin on a network with no address check yet (BTC, DOGE): neither Hidden nor Plain sends it; said, never a dead-end offer. */
export const cantSendYetLine = (symbol: string | undefined): string => `ZeroFee can't send ${symbol && /^[A-Za-z0-9.]{1,12}$/.test(symbol) ? symbol.toUpperCase() : "this"} yet. Nothing moved.`;
