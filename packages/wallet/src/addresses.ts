// Is this a real address on that network? Checked before anything is signed: the bridge's token contract doesn't look
// at the WITHDRAW_TO address, so coins sent to a mistyped one can't come back. A network without a check here can't be
// sent to (D13: it works or it isn't offered).
import { fromBase58 } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** Networks that use Ethereum-style addresses (1Click's ids). */
export const EVM_CHAINS = new Set(["eth", "base", "arb", "op", "pol", "bsc", "gnosis", "avax", "bera", "monad", "xlayer", "plasma", "scroll", "hood"]);

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** EIP-55: all-lower or all-upper is accepted as typed; mixed case must match the checksum exactly. */
export function validEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = hex(keccak_256(new TextEncoder().encode(body.toLowerCase())));
  return [...body].every((c, i) => (/[0-9]/.test(c) ? true : (parseInt(hash[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase())));
}

/** A Solana address is 32 bytes in base58. */
export function validSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  try {
    return fromBase58(address).length === 32;
  } catch {
    return false;
  }
}

/**
 * What kind of NEAR account a string is (ZeroFee Chat's detector, D55), or null:
 *   "implicit"      64 lower-case hex, an ed25519 public key (made by the first NEAR sent to it);
 *   "eth-implicit"  0x + 40 lower-case hex (NEP-518): the same string as an EVM address, so it is NEAR only when the
 *                   person says "on near";
 *   "named"         2–64 characters of NEAR's account rule with at least one dot ("alice.near", "shop.tg"): a word
 *                   with no dot is never taken for an account. A name must still exist on chain (ledger.recipientInfo).
 */
export function nearAccountKind(account: string): "implicit" | "eth-implicit" | "named" | null {
  if (/^[0-9a-f]{64}$/.test(account)) return "implicit";
  if (/^0x[0-9a-f]{40}$/.test(account)) return "eth-implicit";
  if (account.length >= 2 && account.length <= 64 && account.includes(".") && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(account)) return "named";
  return null;
}

/** Whether coins may be sent to `address` on `chain`. False for every network this file doesn't check yet. */
export function validAddress(chain: string, address: string): boolean {
  if (EVM_CHAINS.has(chain)) return validEvmAddress(address);
  if (chain === "sol") return validSolanaAddress(address);
  return false;
}

// Receiving (audit W-4): the deposit bridge's address for a network is checked for that network before it is shown, so a
// wrong or garbled answer is never a place someone sends money to. Checksums where the network has one; the shape
// otherwise. A network without a check here never shows an address.

const BTC58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XRP58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

/** Base58 (Bitcoin's alphabet, or XRP's) to bytes, leading zeros kept; null on any other character. */
function base58Bytes(s: string, alphabet = BTC58): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const v = alphabet.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === alphabet[0]) zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

/** A Base58Check address: its payload (version bytes first) when the 4-byte double-SHA-256 checksum matches. */
function base58Check(s: string, alphabet = BTC58): Uint8Array | null {
  const b = base58Bytes(s, alphabet);
  if (!b || b.length < 5) return null;
  const payload = b.subarray(0, b.length - 4);
  const sum = sha256(sha256(payload));
  return b.subarray(b.length - 4).every((x, i) => x === sum[i]) ? payload : null;
}
const versioned = (payload: Uint8Array | null, length: number, versions: number[][]) =>
  !!payload && payload.length === length && versions.some((v) => v.every((x, i) => payload[i] === x));

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/** A bech32 or bech32m string with this human part (lower case), checksum checked; its data part, or null. */
function bech32Data(s: string, hrp: string, maxLength = 90): number[] | null {
  return bech32Read(s, hrp, maxLength)?.data ?? null;
}
/** The same, saying which checksum it carries (BIP-350: segwit v0 is bech32, v1 and up bech32m). */
function bech32Read(s: string, hrp: string, maxLength = 90): { data: number[]; m: boolean } | null {
  if (s.length > maxLength || s !== s.toLowerCase() || !s.startsWith(`${hrp}1`)) return null;
  const data = [...s.slice(hrp.length + 1)].map((c) => BECH32.indexOf(c));
  if (data.length < 6 || data.some((v) => v < 0)) return null;
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]!;
  }
  return chk === 1 ? { data: data.slice(0, -6), m: false } : chk === 0x2bc830a3 ? { data: data.slice(0, -6), m: true } : null;   // bech32, bech32m
}
/**
 * A segwit address (Bitcoin "bc", Litecoin "ltc") that a person's coins can be sent to and stay theirs (QA's
 * MUST, 5 Nov): version 0 with a bech32 checksum and a 20- or 32-byte program (P2WPKH, P2WSH), or version 1 with a
 * bech32m checksum and 32 bytes (taproot). Any other version, length or checksum is refused: a v1 20-byte program or a
 * future version is anyone's to spend, and the wrong checksum lets a one-letter typo through.
 */
function segwit(s: string, hrp: string): boolean {
  const r = bech32Read(s, hrp);
  if (!r || r.data.length < 1) return false;
  const [version, ...five] = r.data;
  // the program, 5-bit groups to bytes, with at most 4 bits of zero padding (BIP-173)
  let acc = 0, bits = 0;
  const bytes: number[] = [];
  for (const v of five) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) return false;
  if (version === 0) return !r.m && (bytes.length === 20 || bytes.length === 32);
  if (version === 1) return r.m && bytes.length === 32;
  return false;
}
/** The QR form of a segwit address is all capitals: read and sent in lower case (BIP-173 allows either, never mixed). */
export const segwitLower = (a: string): string => (/^(BC|LTC)1[02-9AC-HJ-NP-Z]+$/.test(a) ? a.toLowerCase() : a);

/** CRC16-XMODEM, as Stellar's and TON's addresses carry it. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
/** A Stellar account (G…): base32, version byte 6 << 3, 32 bytes, CRC16 little-endian. */
function stellarAccount(s: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(s)) return false;
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const b = Uint8Array.from(out);
  if (b.length !== 35 || b[0] !== 6 << 3) return false;
  const crc = crc16(b.subarray(0, 33));
  return b[33] === (crc & 0xff) && b[34] === crc >> 8;
}
/** A TON address: raw "<workchain>:<64 hex>", or the 48-character friendly form (base64 or base64url) with its CRC16. */
function tonAddress(s: string): boolean {
  if (/^-?\d{1,3}:[0-9a-fA-F]{64}$/.test(s)) return true;
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(s)) return false;
  const b = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  if (b.length !== 36 || ![0x11, 0x51, 0x91, 0xd1].includes(b[0]!)) return false;
  const crc = crc16(b.subarray(0, 34));
  return b[34] === crc >> 8 && b[35] === (crc & 0xff);
}

const hexAddress = (s: string, min: number, max: number) => new RegExp(`^0x[0-9a-fA-F]{${min},${max}}$`).test(s);

/** Each receive network's check (1Click's ids, catalogue.ts BRIDGE_CHAIN). */
const RECEIVE_CHECKS: Record<string, (a: string) => boolean> = {
  sol: validSolanaAddress,
  fogo: validSolanaAddress,   // Fogo runs the Solana machine: the same 32-byte keys
  btc: (a) => segwit(a, "bc") || versioned(base58Check(a), 21, [[0x00], [0x05]]),
  ltc: (a) => segwit(a, "ltc") || versioned(base58Check(a), 21, [[0x30], [0x32], [0x05]]),
  doge: (a) => versioned(base58Check(a), 21, [[0x1e], [0x16]]),
  dash: (a) => versioned(base58Check(a), 21, [[0x4c], [0x10]]),
  zec: (a) => versioned(base58Check(a), 22, [[0x1c, 0xb8], [0x1c, 0xbd]]),   // transparent t1 / t3
  bch: (a) => /^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$/.test(a) || versioned(base58Check(a), 21, [[0x00], [0x05]]),
  tron: (a) => versioned(base58Check(a), 21, [[0x41]]),
  xrp: (a) => versioned(base58Check(a, XRP58), 21, [[0x00]]),
  stellar: stellarAccount,
  ton: tonAddress,
  cardano: (a) => !!bech32Data(a, "addr", 120),
  aleo: (a) => bech32Data(a, "aleo")?.length === 52,
  aptos: (a) => hexAddress(a, 1, 64),
  movement: (a) => hexAddress(a, 1, 64),
  sui: (a) => hexAddress(a, 64, 64),
  starknet: (a) => hexAddress(a, 1, 64),
  hypercore: validEvmAddress,
};

/** Whether the bridge's deposit address for `chain` is a real address on that network. False for a network not checked here. */
export function validReceiveAddress(chain: string, address: string): boolean {
  if (typeof address !== "string" || address !== address.trim() || !address) return false;
  if (EVM_CHAINS.has(chain)) return validEvmAddress(address);
  return RECEIVE_CHECKS[chain]?.(address) ?? false;
}
