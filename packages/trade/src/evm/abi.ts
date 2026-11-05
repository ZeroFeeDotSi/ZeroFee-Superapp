// The Solidity ABI: the calldata of every contract call this engine makes, and the answers it reads. A small coder for the
// types those calls use (uintN, intN, address, bool, bytesN, bytes, string, T[], T[k] and tuples), checked byte for byte
// against viem (fixtures/viem-vectors.json). Decoding is strict: an offset or length that points outside the data throws,
// so a hostile answer (an aggregator's calldata) can't be read as something it isn't.
//
// Values: uint / int are bigint, address is lower-case hex, bool is boolean, bytes and bytesN are hex, string is a string,
// arrays and tuples are arrays.
import { cat, fromHex, keccak, toHex, utf8, type Hex } from "./bytes.ts";
import { decodeTuple, dynamic, headSize, parseType, W, type AbiType, type AbiValue } from "./wire.ts";
export { abiDecode, parseType, type AbiType, type AbiValue } from "./wire.ts";

const big32 = (n: bigint): Uint8Array => { const b = new Uint8Array(W); let x = n; for (let i = W - 1; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };
const padRight = (b: Uint8Array): Uint8Array => { const n = Math.ceil(b.length / W) * W; const out = new Uint8Array(n); out.set(b); return out; };

function encodeOne(t: AbiType, v: AbiValue): Uint8Array {
  switch (t.k) {
    case "uint": {
      const n = typeof v === "bigint" ? v : BigInt(v as never);
      if (n < 0n || n >= 1n << BigInt(t.bits)) throw new Error(`abi: uint${t.bits} out of range`);
      return big32(n);
    }
    case "int": {
      const n = typeof v === "bigint" ? v : BigInt(v as never);
      const lim = 1n << BigInt(t.bits - 1);
      if (n < -lim || n >= lim) throw new Error(`abi: int${t.bits} out of range`);
      return big32(n < 0n ? (1n << 256n) + n : n);
    }
    case "address": {
      const b = fromHex(String(v));
      if (b.length !== 20) throw new Error("abi: address is not 20 bytes");
      const out = new Uint8Array(W); out.set(b, 12); return out;
    }
    case "bool": return big32(v === true ? 1n : 0n);
    case "fixed": {
      const b = fromHex(String(v));
      if (b.length !== t.size) throw new Error(`abi: bytes${t.size} has ${b.length} bytes`);
      return padRight(b);
    }
    case "bytes": case "string": {
      const b = t.k === "string" ? utf8(String(v)) : fromHex(String(v));
      return cat(big32(BigInt(b.length)), padRight(b));
    }
    case "array": {
      const xs = v as AbiValue[];
      if (!Array.isArray(xs) || (t.len !== undefined && xs.length !== t.len)) throw new Error("abi: array length");
      const body = encodeTuple(xs.map(() => t.of), xs);
      return t.len === undefined ? cat(big32(BigInt(xs.length)), body) : body;
    }
    case "tuple": return encodeTuple(t.of, v as AbiValue[]);
  }
}

function encodeTuple(types: AbiType[], values: AbiValue[]): Uint8Array {
  if (!Array.isArray(values) || values.length !== types.length) throw new Error("abi: tuple length");
  const heads: Uint8Array[] = [], tails: Uint8Array[] = [];
  let tailAt = types.reduce((n, t) => n + headSize(t), 0);
  types.forEach((t, i) => {
    const enc = encodeOne(t, values[i]!);
    if (dynamic(t)) { heads.push(big32(BigInt(tailAt))); tails.push(enc); tailAt += enc.length; }
    else heads.push(enc);
  });
  return cat(...heads, ...tails);
}

/** abi.encode(values) for these types. */
export const abiEncode = (types: string[], values: AbiValue[]): Hex => toHex(encodeTuple(types.map(parseType), values));
export interface AbiFunction { name: string; signature: string; selector: Hex; inputs: AbiType[] }
const fns = new Map<string, AbiFunction>();
/** "name(type,type,…)" in canonical form (no spaces, no parameter names). */
export function fn(signature: string): AbiFunction {
  const hit = fns.get(signature);
  if (hit) return hit;
  const i = signature.indexOf("(");
  const t = parseType(signature.slice(i));
  if (i <= 0 || t.k !== "tuple") throw new Error(`abi: bad signature ${signature}`);
  const f = { name: signature.slice(0, i), signature, selector: toHex(keccak(utf8(signature)).subarray(0, 4)), inputs: t.of };
  fns.set(signature, f);
  return f;
}
export const selectorOf = (signature: string): Hex => fn(signature).selector;
/** The calldata of a call: selector + abi.encode(args). */
export function encodeCall(signature: string, args: AbiValue[]): Hex {
  const f = fn(signature);
  return f.selector + toHex(encodeTuple(f.inputs, args)).slice(2);
}
/** The arguments of a call to `signature`, or undefined when the selector is another function's. Throws when the body is malformed. */
export function decodeCall(signature: string, data: Hex): AbiValue[] | undefined {
  const f = fn(signature);
  if (!data.toLowerCase().startsWith(f.selector)) return undefined;
  return decodeTuple(f.inputs, fromHex(data).subarray(4), 0);
}
/** keccak256 of an event's signature: its topic 0. */
export const topicOf = (signature: string): Hex => toHex(keccak(utf8(signature)));
