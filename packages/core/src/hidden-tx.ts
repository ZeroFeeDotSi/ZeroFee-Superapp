// Leg 1 of a token Send (hidden-coins.ts), built by the core: the token's own transfer to 1Click's address, nothing else.
import { SOL } from "./solana.ts";
import { base64, cat, fromBase58, u64le } from "./sol/bytes.ts";
import { ata } from "./sol/decode.ts";

/**
 * Leg 1 of a token Send on Solana, built by the core: `from` the only signer and fee payer; (1) the Associated Token
 * Account program's CreateIdempotent of `to`'s account for the mint (paid by `from`; nothing if it is there), (2) the
 * Token program's TransferChecked of exactly `units` (at the mint's `decimals`) from `from`'s own account to it. Nothing
 * else. Unsigned, base64, as signSolTx takes it.
 */
export function solTokenSendTx(from: string, to: string, mint: string, units: bigint, decimals: number, blockhash: string): string {
  if (from === to || units <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("a token transfer goes to another address, of more than nothing");
  const src = ata(from, mint, SOL.token), dst = ata(to, mint, SOL.token);
  if (!src || !dst) throw new Error("no token account for that address");
  // writable signer, writable, writable, then read-only: the owner, the mint and the three programs
  const keys = [from, src, dst, to, mint, SOL.system, SOL.token, SOL.ata].map(fromBase58);
  const create = cat([7, 6, 0, 2, 3, 4, 5, 6, 1, 1]);
  const transfer = cat([6, 4, 1, 4, 2, 0, 10, 12], u64le(units), [decimals]);
  const message = cat([1, 0, 5, keys.length], ...keys, fromBase58(blockhash), [2], create, transfer);
  return base64(cat([1], new Uint8Array(64), message));
}

/** Leg 1 of a token Send on Robinhood Chain: the ERC-20's transfer(to, units), as call data. */
export function erc20TransferData(to: string, units: bigint): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || units <= 0n || units >= 1n << 256n) throw new Error("a transfer goes to an address, of more than nothing");
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${units.toString(16).padStart(64, "0")}`;
}
