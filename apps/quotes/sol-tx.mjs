// One Solana transaction on the wire, legacy or v0, checked byte by byte for POST /v0/sol/send. No dependency: the
// relay only needs to know the bytes are exactly one well-formed transaction, never what it does.
//   signatures: compact-u16 n, n × 64 bytes
//   message:    [0x80 | version] (v0 only), header (3 bytes), compact-u16 keys × 32, blockhash (32),
//               compact-u16 instructions × { program index, compact-u16 account indices, compact-u16 data },
//               v0 only: compact-u16 lookups × { key (32), compact-u16 writable indices, compact-u16 readonly indices }

/** The largest transaction Solana takes (its packet size). */
export const SOL_TX_MAX = 1232;

/** True when `bytes` is exactly one legacy or v0 transaction, with nothing left over. */
export function isSolanaTx(bytes) {
  return solanaTxParts(bytes) !== null;
}

/**
 * The parts of exactly one legacy or v0 transaction: its signatures, the keys that must sign (the message's first
 * keys, the fee payer first, in the signatures' order), the message they sign and its recent blockhash. Null when it
 * isn't one.
 */
export function solanaTxParts(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > SOL_TX_MAX) return null;
  let at = 0;
  const take = (n) => {
    if (n < 0 || at + n > bytes.length) throw new RangeError("short");
    at += n;
    return at - n;
  };
  const u8 = () => bytes[take(1)];
  /** compact-u16: up to 3 bytes, 7 bits each, in its shortest form only. */
  const compact = () => {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const b = u8();
      value |= (b & 0x7f) << (7 * i);
      if ((b & 0x80) === 0) {
        if (i > 0 && b === 0) throw new RangeError("not shortest");
        if (value > 0xffff) throw new RangeError("too big");
        return value;
      }
    }
    throw new RangeError("too long");
  };
  try {
    const sigs = compact();
    if (sigs === 0) return null;
    const sigsAt = take(64 * sigs);
    const messageAt = at;
    let v0 = false;
    if (bytes[at] & 0x80) {
      if ((u8() & 0x7f) !== 0) return null; // only version 0 exists
      v0 = true;
    }
    const required = u8();
    const readonlySigned = u8();
    const readonlyUnsigned = u8();
    const keys = compact();
    if (required !== sigs || readonlySigned >= required || keys < required || readonlyUnsigned > keys - required) return null;
    const keysAt = take(32 * keys);
    const blockhashAt = take(32);
    const instructions = [];
    for (let n = compact(); n > 0; n--) {
      const program = u8();
      const accounts = compact();
      const indices = bytes.subarray(take(accounts), at);
      take(compact());
      instructions.push([program, indices]);
    }
    let loaded = 0;
    if (v0) {
      for (let n = compact(); n > 0; n--) {
        take(32);
        const writable = compact();
        take(writable);
        const readonly = compact();
        take(readonly);
        if (writable + readonly === 0) return null;
        loaded += writable + readonly;
      }
    }
    if (at !== bytes.length) return null;
    const total = keys + loaded;
    // A program is always one of the message's own keys, never a looked-up one.
    if (!instructions.every(([program, indices]) => program < keys && indices.every((i) => i < total))) return null;
    const signatures = [];
    const signers = [];
    for (let i = 0; i < sigs; i++) {
      signatures.push(bytes.subarray(sigsAt + 64 * i, sigsAt + 64 * (i + 1)));
      signers.push(bytes.subarray(keysAt + 32 * i, keysAt + 32 * (i + 1)));
    }
    return { signatures, signers, message: bytes.subarray(messageAt), blockhash: bytes.subarray(blockhashAt, blockhashAt + 32) };
  } catch {
    return null;
  }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Bytes in base58 (a blockhash, as Solana's RPC names it). */
export function b58encode(bytes) {
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
