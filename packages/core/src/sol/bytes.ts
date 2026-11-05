// Vendored from packages/trade/src/sol/bytes.ts (main 5483d5f), reviewed by S1. Keep in step with the original.
// Bytes for Solana: base58 (addresses), base64 (what nodes send), little-endian integers. No Buffer: a browser has none.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join("");
}

export function fromBase58(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = INDEX.get(s[i]!);
    if (carry === undefined) throw new Error(`not base58: ${s}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes.reverse(), zeros);
  return out;
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const u64At = (b: Uint8Array, o: number): bigint => dv(b).getBigUint64(o, true);
export const u16At = (b: Uint8Array, o: number): number => dv(b).getUint16(o, true);
export const pkAt = (b: Uint8Array, o: number): string => base58(b.subarray(o, o + 32));
export const u64le = (n: bigint): Uint8Array => { const o = new Uint8Array(8); dv(o).setBigUint64(0, n, true); return o; };
export const u32le = (n: number): Uint8Array => { const o = new Uint8Array(4); dv(o).setUint32(0, n, true); return o; };
export const cat = (...p: (Uint8Array | number[])[]): Uint8Array => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) { o.set(x, i); i += x.length; }
  return o;
};
export const hex8 = (b: Uint8Array): string => Array.from(b.subarray(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
