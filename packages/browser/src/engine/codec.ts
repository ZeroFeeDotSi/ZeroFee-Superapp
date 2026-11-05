// The few byte conversions the engine needs between what sites send (hex, text, base64) and what the core takes
// (base64), plus base58 for Solana's transaction signatures. Plain functions, no dependencies.

// Runs in the web page and the phone's web view, so no Node APIs (no Buffer).
export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const isHex = (value: unknown): value is string => typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
export const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16));
export const toHex = (bytes: Uint8Array): string => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of text) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
