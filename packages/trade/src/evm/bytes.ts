// Bytes for BNB Chain and Robinhood Chain: hex (what nodes send), base64 (what the trade service carries), keccak-256 and
// 32-byte words. No Buffer: a browser has none. Addresses are kept lower-case; nothing here needs the checksum form.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { fromBase64, fromHex, toHex, type Hex } from "./wire.ts";
export { fromBase64, fromHex, toHex, type Hex };

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const keccak = (b: Uint8Array): Uint8Array => keccak_256(b);
export const keccakHex = (b: Uint8Array | string): Hex => toHex(keccak_256(typeof b === "string" ? fromHex(b) : b));
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? B64[n & 63]! : "=");
  }
  return s;
}
/** A big-endian unsigned integer in the fewest bytes (0 = no bytes), as RLP wants it. */
export function bigBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error("negative");
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return fromHex(h);
}

/** One 32-byte ABI word as 64 hex characters (no 0x): an address, a bigint or hex. */
export function word(v: string | bigint): string {
  const s = typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/i, "").toLowerCase();
  if (s.length > 64) throw new Error("word too long");
  return s.padStart(64, "0");
}
/** The 32-byte words of an eth_call answer (hex, no 0x each). */
export const words = (r: unknown): string[] => (typeof r === "string" && r.length >= 2 ? (r.slice(2).match(/.{64}/g) ?? []) : []);
export const wordBig = (w: string | undefined): bigint => (w ? BigInt("0x" + w) : 0n);
export const wordAddr = (w: string | undefined): string => "0x" + (w ?? "").padStart(64, "0").slice(24).toLowerCase();

export const lower = (a: string): string => a.toLowerCase();
export const same = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
export const isZeroAddr = (a: string): boolean => /^0x0{40}$/i.test(a);
export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const hexBig = (n: bigint): Hex => "0x" + n.toString(16);
/** A node's hex quantity as a bigint; anything else throws (a node that answers badly is not believed). */
export function bigOf(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new Error(`${what}: expected hex, got ${JSON.stringify(v)?.slice(0, 40)}`);
  return v === "0x" ? 0n : BigInt(v);
}
