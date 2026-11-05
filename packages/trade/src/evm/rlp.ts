// RLP, the encoding of an Ethereum transaction (Yellow Paper, appendix B). An item is a byte string or a list of items.
import { cat } from "./bytes.ts";
import type { Rlp } from "./wire.ts";
export { rlpDecode, type Rlp } from "./wire.ts";


function lengthBytes(n: number): Uint8Array {
  const out: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) out.unshift(x % 256);
  return Uint8Array.from(out);
}
function header(len: number, short: number): Uint8Array {
  if (len < 56) return Uint8Array.of(short + len);
  const l = lengthBytes(len);
  return cat(Uint8Array.of(short + 55 + l.length), l);
}

export function rlpEncode(x: Rlp): Uint8Array {
  if (x instanceof Uint8Array) {
    if (x.length === 1 && x[0]! < 0x80) return x;
    return cat(header(x.length, 0x80), x);
  }
  const body = cat(...x.map(rlpEncode));
  return cat(header(body.length, 0xc0), body);
}

