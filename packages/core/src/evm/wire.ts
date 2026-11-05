// Vendored from packages/trade/src/evm/wire.ts (main e3a1260), reviewed by S1. Keep in step with the original.
// Reading BNB Chain / Robinhood Chain transactions back: hex and base64, RLP, the ABI and the EIP-1559 envelope. No
// dependencies and no I/O, so the security layer can vendor it with the decoder (decode.ts). The engine's writers (abi.ts,
// rlp.ts, tx.ts, bytes.ts) use these same readers.
export type Hex = string;

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
  if (s.length % 2 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error(`not hex: ${h.slice(0, 20)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
export function toHex(b: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < b.length; i++) s += HEX[b[i]!];
  return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("not base64");
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

export type Rlp = Uint8Array | Rlp[];
/** Decodes one item that spans all of `b`. Throws on trailing bytes, a non-minimal length, or a short read. */
export function rlpDecode(b: Uint8Array): Rlp {
  const [item, end] = decodeAt(b, 0);
  if (end !== b.length) throw new Error("rlp: trailing bytes");
  return item;
}

function decodeAt(b: Uint8Array, at: number): [Rlp, number] {
  const p = b[at];
  if (p === undefined) throw new Error("rlp: short");
  if (p < 0x80) return [b.subarray(at, at + 1), at + 1];
  const list = p >= 0xc0;
  const base = list ? 0xc0 : 0x80;
  let len: number, start: number;
  if (p - base < 56) { len = p - base; start = at + 1; }
  else {
    const ll = p - base - 55;
    if (b[at + 1] === 0) throw new Error("rlp: non-minimal length");
    len = 0;
    for (let i = 0; i < ll; i++) { const c = b[at + 1 + i]; if (c === undefined) throw new Error("rlp: short"); len = len * 256 + c; }
    if (len < 56) throw new Error("rlp: non-minimal length");
    start = at + 1 + ll;
  }
  const end = start + len;
  if (end > b.length) throw new Error("rlp: short");
  if (!list) {
    if (len === 1 && b[start]! < 0x80) throw new Error("rlp: non-minimal byte");
    return [b.subarray(start, end), end];
  }
  const items: Rlp[] = [];
  for (let i = start; i < end;) { const [it, next] = decodeAt(b, i); items.push(it); i = next; }
  return [items, end];
}

// ---- the ABI (strict: an offset or length that points outside the data throws) ----
export type AbiType =
  | { k: "uint" | "int"; bits: number } | { k: "address" } | { k: "bool" } | { k: "bytes" } | { k: "string" }
  | { k: "fixed"; size: number } | { k: "array"; of: AbiType; len?: number } | { k: "tuple"; of: AbiType[] };
export type AbiValue = bigint | string | boolean | AbiValue[];

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  if (s.length) out.push(s.slice(from));
  return out;
}

const parsed = new Map<string, AbiType>();
export function parseType(s0: string): AbiType {
  const hit = parsed.get(s0);
  if (hit) return hit;
  const s = s0.trim();
  let t: AbiType;
  const arr = /^(.*)\[(\d*)\]$/.exec(s);
  if (arr) t = { k: "array", of: parseType(arr[1]!), ...(arr[2] ? { len: Number(arr[2]) } : {}) };
  else if (s.startsWith("(") && s.endsWith(")")) t = { k: "tuple", of: splitTop(s.slice(1, -1)).map(parseType) };
  else if (s === "address") t = { k: "address" };
  else if (s === "bool") t = { k: "bool" };
  else if (s === "bytes") t = { k: "bytes" };
  else if (s === "string") t = { k: "string" };
  else if (/^bytes\d+$/.test(s)) t = { k: "fixed", size: Number(s.slice(5)) };
  else if (/^u?int\d*$/.test(s)) { const u = s.startsWith("u"); const bits = Number(s.slice(u ? 4 : 3) || 256); t = { k: u ? "uint" : "int", bits }; }
  else throw new Error(`abi: unknown type ${s}`);
  if (t.k === "fixed" && !(t.size >= 1 && t.size <= 32)) throw new Error(`abi: bad ${s}`);
  if ((t.k === "uint" || t.k === "int") && !(t.bits >= 8 && t.bits <= 256 && t.bits % 8 === 0)) throw new Error(`abi: bad ${s}`);
  parsed.set(s0, t);
  return t;
}

export const dynamic = (t: AbiType): boolean =>
  t.k === "bytes" || t.k === "string" || (t.k === "array" && (t.len === undefined || dynamic(t.of))) || (t.k === "tuple" && t.of.some(dynamic));
/** Bytes of a static type's head. */
export const headSize = (t: AbiType): number => (dynamic(t) ? 32 : t.k === "tuple" ? t.of.reduce((n, x) => n + headSize(x), 0) : t.k === "array" ? t.len! * headSize(t.of) : 32);

export const W = 32;
function readWord(d: Uint8Array, at: number): bigint {
  if (at < 0 || at + W > d.length) throw new Error("abi: read past the end");
  let n = 0n;
  for (let i = 0; i < W; i++) n = (n << 8n) | BigInt(d[at + i]!);
  return n;
}
const readOffset = (d: Uint8Array, at: number): number => { const n = readWord(d, at); if (n > BigInt(d.length)) throw new Error("abi: offset past the end"); return Number(n); };

function decodeOne(t: AbiType, d: Uint8Array, at: number): AbiValue {
  switch (t.k) {
    case "uint": {
      const n = readWord(d, at);
      if (n >= 1n << BigInt(t.bits)) throw new Error(`abi: uint${t.bits} out of range`);
      return n;
    }
    case "int": {
      const n = readWord(d, at);
      const v = n >= 1n << 255n ? n - (1n << 256n) : n;
      const lim = 1n << BigInt(t.bits - 1);
      if (v < -lim || v >= lim) throw new Error(`abi: int${t.bits} out of range`);
      return v;
    }
    case "address": {
      const n = readWord(d, at);
      if (n >> 160n) throw new Error("abi: dirty address");
      return toHex(d.subarray(at + 12, at + W));
    }
    case "bool": { const n = readWord(d, at); if (n > 1n) throw new Error("abi: bad bool"); return n === 1n; }
    case "fixed": readWord(d, at); return toHex(d.subarray(at, at + t.size));
    case "bytes": case "string": {
      const len = readOffset(d, at);
      if (at + W + len > d.length) throw new Error("abi: bytes past the end");
      const b = d.subarray(at + W, at + W + len);
      return t.k === "string" ? new TextDecoder("utf-8", { fatal: true }).decode(b) : toHex(b);
    }
    case "array": {
      const n = t.len ?? readOffset(d, at);
      const base = t.len === undefined ? at + W : at;
      if (n > d.length) throw new Error("abi: array too long");
      return decodeTuple(Array.from({ length: n }, () => t.of), d, base);
    }
    case "tuple": return decodeTuple(t.of, d, at);
  }
}

export function decodeTuple(types: AbiType[], d: Uint8Array, base: number): AbiValue[] {
  let head = base;
  return types.map((t) => {
    const at = head;
    head += headSize(t);
    return dynamic(t) ? decodeOne(t, d, base + readOffset(d, at)) : decodeOne(t, d, at);
  });
}
/** abi.decode(data, types). Throws on anything malformed. */
export const abiDecode = (types: string[], data: Hex | Uint8Array): AbiValue[] => decodeTuple(types.map(parseType), typeof data === "string" ? fromHex(data) : data, 0);

// ---- the EIP-1559 envelope ----
export interface Eip1559 {
  chainId: number; nonce: number;
  maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; gas: bigint;
  to: string; value: bigint; data: Hex;
}
export interface Signature { yParity: number; r: bigint; s: bigint }

const num = (b: Rlp, what: string): bigint => {
  if (!(b instanceof Uint8Array)) throw new Error(`tx: ${what} is a list`);
  if (b.length > 1 && b[0] === 0) throw new Error(`tx: ${what} has a leading zero`);
  return b.length ? BigInt(toHex(b)) : 0n;
};

/** Reads an EIP-1559 transaction (unsigned or signed; raw bytes, 0x hex or base64). Throws on anything else. */
export function parseTx(input: Uint8Array | string): Eip1559 & { signature?: Signature } {
  const b = typeof input === "string" ? (input.startsWith("0x") ? fromHex(input) : fromBase64(input)) : input;
  if (b[0] !== 2) throw new Error("tx: not an EIP-1559 transaction");
  const f = rlpDecode(b.subarray(1));
  if (!Array.isArray(f) || (f.length !== 9 && f.length !== 12)) throw new Error("tx: wrong field count");
  const to = f[5]!, data = f[7]!, al = f[8]!;
  if (!(to instanceof Uint8Array) || to.length !== 20) throw new Error("tx: `to` is not an address");
  if (!(data instanceof Uint8Array) || !Array.isArray(al)) throw new Error("tx: bad data or access list");
  const t = {
    chainId: Number(num(f[0]!, "chainId")), nonce: Number(num(f[1]!, "nonce")), maxPriorityFeePerGas: num(f[2]!, "tip"), maxFeePerGas: num(f[3]!, "fee"), gas: num(f[4]!, "gas"),
    to: toHex(to), value: num(f[6]!, "value"), data: toHex(data),
  };
  return f.length === 12 ? { ...t, signature: { yParity: Number(num(f[9]!, "yParity")), r: num(f[10]!, "r"), s: num(f[11]!, "s") } } : t;
}
