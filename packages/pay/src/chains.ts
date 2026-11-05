// The chains Pay can pay out on, and how to recognise their addresses.
//
// Chain ids are 1Click's blockchain ids ("near", "base", "sol", …), the same ids the ledger uses. This is recognition
// only: it tells Pay which chains an address could belong to. The ledger validates an address strictly before
// anything is signed (S3), and the approval sheet shows it in full (S1).
import { keccak_256 } from "@noble/hashes/sha3.js";

export type ChainKind = "near" | "evm" | "solana" | "utxo" | "tron" | "ton" | "xrp" | "stellar" | "move";

export interface ChainInfo {
  id: string;
  name: string;
  kind: ChainKind;
  /** EIP-155 id, for EVM chains. */
  evmChainId?: number;
  /** The payment-code scheme for this chain, e.g. "bitcoin" in "bitcoin:bc1…?amount=…". */
  uriScheme?: string;
  /** Some chains need a memo or tag with the address when paying an exchange. */
  memo?: "tag" | "text";
  /** False where the ledger's withdraw can't carry that memo (S3: TON and Stellar), so a payee that needs one is refused. */
  memoSendable?: boolean;
}

const evm = (id: string, name: string, evmChainId: number): ChainInfo => ({ id, name, kind: "evm", evmChainId });

export const CHAINS: readonly ChainInfo[] = [
  { id: "near", name: "NEAR", kind: "near" },
  evm("eth", "Ethereum", 1),
  evm("base", "Base", 8453),
  evm("arb", "Arbitrum", 42161),
  evm("op", "Optimism", 10),
  evm("pol", "Polygon", 137),
  evm("bsc", "BNB Chain", 56),
  evm("gnosis", "Gnosis", 100),
  evm("avax", "Avalanche", 43114),
  evm("scroll", "Scroll", 534352),
  evm("monad", "Monad", 143),
  evm("bera", "Berachain", 80094),
  evm("xlayer", "X Layer", 196),
  evm("plasma", "Plasma", 9745),
  // Home's ETH (RH) wallet lives here (D124), and 1Click pays out on it (nep141:hood.omft.near). Its chain id is Trade's
  // engine's (packages/trade/src/evm/chains.ts).
  evm("hood", "Robinhood Chain", 4663),
  { id: "sol", name: "Solana", kind: "solana", uriScheme: "solana" },
  { id: "btc", name: "Bitcoin", kind: "utxo", uriScheme: "bitcoin" },
  { id: "ltc", name: "Litecoin", kind: "utxo", uriScheme: "litecoin" },
  { id: "doge", name: "Dogecoin", kind: "utxo", uriScheme: "dogecoin" },
  { id: "bch", name: "Bitcoin Cash", kind: "utxo", uriScheme: "bitcoincash" },
  { id: "dash", name: "Dash", kind: "utxo", uriScheme: "dash" },
  { id: "zec", name: "Zcash", kind: "utxo", uriScheme: "zcash" },
  { id: "tron", name: "Tron", kind: "tron", uriScheme: "tron" },
  { id: "ton", name: "TON", kind: "ton", uriScheme: "ton", memo: "text", memoSendable: false },
  { id: "xrp", name: "XRP Ledger", kind: "xrp", uriScheme: "xrpl", memo: "tag", memoSendable: true },
  { id: "stellar", name: "Stellar", kind: "stellar", uriScheme: "web+stellar", memo: "text", memoSendable: false },
  { id: "sui", name: "Sui", kind: "move" },
  { id: "aptos", name: "Aptos", kind: "move" },
];

const byId = new Map(CHAINS.map((c) => [c.id, c]));
const byEvmId = new Map(CHAINS.filter((c) => c.evmChainId).map((c) => [c.evmChainId, c]));

export function chain(id: string): ChainInfo | undefined {
  return byId.get(id);
}

/** Networks Pay doesn't pay out on, named for people all the same. Not in CHAINS, so an address is never guessed to be on them. */
const NAMED_ONLY: Record<string, string> = { xmr: "Monero" };

/** A network's name for a person ("BNB Chain", "Robinhood Chain"): never its raw id ("bsc", "hood") on a screen. An id
 *  with no name at all reads in capitals, as Add's list does. */
export function chainName(id: string): string {
  return byId.get(id)?.name ?? NAMED_ONLY[id] ?? id.toUpperCase();
}

export function chainByEvmId(evmChainId: number): ChainInfo | undefined {
  return byEvmId.get(evmChainId);
}

export const EVM_CHAINS: readonly ChainInfo[] = CHAINS.filter((c) => c.kind === "evm");

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes base58 (Bitcoin alphabet). Null on any character outside it. */
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const v = BASE58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** NEAR account ids: "alex.near", "alex.zerofee.near", or a 64-hex implicit account. */
export function isNearAccount(s: string): boolean {
  if (s.length < 2 || s.length > 64) return false;
  if (/^[0-9a-f]{64}$/.test(s)) return true;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
}

/** A NEAR name a person would type: it has a dot (top-level names are reserved for registrars). */
export function isNamedNearAccount(s: string): boolean {
  return s.includes(".") && isNearAccount(s);
}

/** EIP-55: a mixed-case EVM address carries a checksum; all-lower or all-upper carries none. */
export function evmChecksumOk(address: string): boolean {
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = keccak_256(new TextEncoder().encode(hex.toLowerCase()));
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    const c = hex[i];
    if (/[a-f]/.test(c) && nibble >= 8) return false;
    if (/[A-F]/.test(c) && nibble < 8) return false;
  }
  return true;
}

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const BECH32 = "[02-9ac-hj-np-z]";

/**
 * Which chains could this address be on? Several for EVM (the same address works on every EVM chain, so the code must
 * say which), one for most others, none if it isn't an address we know.
 */
export function chainsForAddress(raw: string): string[] {
  const a = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return evmChecksumOk(a) ? EVM_CHAINS.map((c) => c.id) : [];
  if (/^0x[0-9a-fA-F]{64}$/.test(a)) return ["sui", "aptos"];
  const found: string[] = [];
  if (isNamedNearAccount(a) || /^[0-9a-f]{64}$/.test(a)) found.push("near");
  if (new RegExp(`^(bc1${BECH32}{11,71}|[13]${B58}{25,34})$`).test(a)) found.push("btc");
  if (new RegExp(`^(ltc1${BECH32}{11,71}|[LM]${B58}{26,33})$`).test(a)) found.push("ltc");
  if (new RegExp(`^D${B58}{33}$`).test(a)) found.push("doge");
  if (new RegExp(`^(bitcoincash:)?[qp]${BECH32}{41}$`).test(a)) found.push("bch");
  if (new RegExp(`^X${B58}{33}$`).test(a)) found.push("dash");
  if (new RegExp(`^t[13]${B58}{33}$`).test(a)) found.push("zec");
  if (new RegExp(`^T${B58}{33}$`).test(a)) found.push("tron");
  if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(a) || /^-?[01]:[0-9a-fA-F]{64}$/.test(a)) found.push("ton");
  if (new RegExp(`^r${B58}{24,34}$`).test(a)) found.push("xrp");
  if (/^G[A-Z2-7]{55}$/.test(a)) found.push("stellar");
  if (new RegExp(`^${B58}{32,44}$`).test(a) && base58Decode(a)?.length === 32) found.push("sol");
  return found;
}

/** Short form for screens: "0xAB12…9F3C". The approval sheet always shows the full address. */
export function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
