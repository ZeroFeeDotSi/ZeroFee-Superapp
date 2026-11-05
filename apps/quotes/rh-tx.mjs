// One signed Robinhood Chain transaction, read before POST /v0/rh/rpc sends it (rh-rpc.mjs; review LOW, QA):
// legacy (EIP-155, chain id 4663), EIP-2930 (type 1) or EIP-1559 (type 2), its sender recovered from its signature
// with secp256k1. Anything that doesn't parse as exactly one such transaction, names another chain, or whose signature
// doesn't recover (r, s out of range, a high s, a bad parity) is refused before Alchemy is asked: a transaction the
// network would drop never spends the relay's send budget, the same rule as /v0/sol/send and /v0/near/send.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const RH_CHAIN_ID = 4663n;
/** The largest signed transaction taken (a swap through a long route is a few KB). */
export const RH_SEND_TX_MAX = 64 * 1024;
const N = secp256k1.Point.CURVE().n;

/** One RLP item at `at`: { list, start (of its payload), end, raw: [at, end) }; null when it isn't canonical RLP. */
function item(b, at, limit) {
  if (at >= limit) return null;
  const p = b[at];
  const long = (lenOf, base) => {
    const n = p - base;
    if (at + 1 + n > limit || b[at + 1] === 0) return null;
    let len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[at + 1 + i];
    if (len < 56 || at + 1 + n + len > limit) return null;
    return { list: lenOf, start: at + 1 + n, end: at + 1 + n + len };
  };
  if (p < 0x80) return { list: false, start: at, end: at + 1 };
  if (p <= 0xb7) {
    const len = p - 0x80;
    if (at + 1 + len > limit || (len === 1 && b[at + 1] < 0x80)) return null;
    return { list: false, start: at + 1, end: at + 1 + len };
  }
  if (p <= 0xbf) return long(false, 0xb7);
  if (p <= 0xf7) {
    const len = p - 0xc0;
    return at + 1 + len > limit ? null : { list: true, start: at + 1, end: at + 1 + len };
  }
  return long(true, 0xf7);
}

/** A list's items (each with its raw bytes), or null. */
function listOf(b, at, limit) {
  const l = item(b, at, limit);
  if (!l || !l.list) return null;
  const out = [];
  for (let i = l.start; i < l.end; ) {
    const it = item(b, i, l.end);
    if (!it) return null;
    out.push({ ...it, raw: b.subarray(i, it.end) });
    i = it.end;
  }
  return { items: out, end: l.end };
}

/** A canonical integer (no leading zero byte), or null. */
function int(b, it) {
  if (it.list || it.end - it.start > 32) return null;
  const v = b.subarray(it.start, it.end);
  if (v.length > 0 && v[0] === 0) return null;
  let n = 0n;
  for (const x of v) n = (n << 8n) | BigInt(x);
  return n;
}

/** An RLP list holding these raw items, prefixed with `type` when it is a typed transaction. */
function encodeList(raws, type) {
  const len = raws.reduce((n, r) => n + r.length, 0);
  const lenBytes = [];
  for (let l = len; l > 0; l = Math.floor(l / 256)) lenBytes.unshift(l % 256);
  const head = len < 56 ? [0xc0 + len] : [0xf7 + lenBytes.length, ...lenBytes];
  const out = new Uint8Array((type === null ? 0 : 1) + head.length + len);
  let at = 0;
  if (type !== null) out[at++] = type;
  out.set(head, at);
  at += head.length;
  for (const r of raws) (out.set(r, at), (at += r.length));
  return out;
}

const hex = (b) => Buffer.from(b).toString("hex");

/** RLP of a small positive integer (a chain id). */
function rlpInt(n) {
  const bytes = [];
  for (let x = n; x > 0n; x >>= 8n) bytes.unshift(Number(x & 0xffn));
  return new Uint8Array(bytes.length === 1 && bytes[0] < 0x80 ? bytes : [0x80 + bytes.length, ...bytes]);
}

/** The sender (0x + 40 lowercase hex) of one signed transaction given as 0x-hex for `chainId` (Robinhood Chain's unless a
 *  test names another), or null. */
export function rhTxSender(rawHex, chainId = RH_CHAIN_ID) {
  if (typeof rawHex !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(rawHex) || rawHex.length > 2 + 2 * RH_SEND_TX_MAX) return null;
  const b = new Uint8Array(Buffer.from(rawHex.slice(2), "hex"));
  const type = b[0] === 0x01 || b[0] === 0x02 ? b[0] : b[0] >= 0xc0 ? null : -1;
  if (type === -1) return null;
  const at = type === null ? 0 : 1;
  const l = listOf(b, at, b.length);
  if (!l || l.end !== b.length) return null;
  const fields = type === null ? 9 : type === 1 ? 11 : 12;
  if (l.items.length !== fields) return null;
  const [vIt, rIt, sIt] = l.items.slice(-3);
  const v = int(b, vIt), r = int(b, rIt), s = int(b, sIt);
  if (v === null || r === null || s === null || r <= 0n || r >= N || s <= 0n || s > N / 2n) return null;
  let parity;
  let unsigned;
  if (type === null) {
    // EIP-155 only: v = chainId * 2 + 35 + parity (a v of 27/28 signs for every chain and is refused)
    if (v !== chainId * 2n + 35n && v !== chainId * 2n + 36n) return null;
    parity = Number(v - chainId * 2n - 35n);
    // what was signed: the six fields, then the chain id and two empty strings
    unsigned = encodeList([...l.items.slice(0, 6).map((x) => x.raw), rlpInt(chainId), new Uint8Array([0x80]), new Uint8Array([0x80])], null);
  } else {
    if (int(b, l.items[0]) !== chainId || (v !== 0n && v !== 1n)) return null;
    parity = Number(v);
    unsigned = encodeList(l.items.slice(0, fields - 3).map((x) => x.raw), type);
  }
  try {
    const sig = new secp256k1.Signature(r, s, parity);
    const pub = sig.recoverPublicKey(keccak_256(unsigned)).toBytes(false);
    return `0x${hex(keccak_256(pub.subarray(1)).subarray(12))}`;
  } catch {
    return null;
  }
}
