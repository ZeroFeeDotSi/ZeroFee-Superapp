// The decoder: the exact transaction bytes that will be signed → what they really do.
//
// The approval screen is built from this, never from the asking app's request. It is written independently of the
// library that serialises transactions (@fastnear/utils), so a bug in one is caught by the other: after building, the
// Signer decodes the bytes and refuses to sign unless they match the request exactly (see sameTransaction below).
// Anything this decoder can't read (an action kind it doesn't know, a newer transaction format, trailing bytes) is
// refused: we never sign what we can't show.
import { toBase58 } from "@fastnear/utils";
import { base58Encode, mlDsaKeyHandle } from "./key-handle.ts";

export type KeyType = "ed25519" | "secp256k1" | "ml-dsa-65";

export interface DecodedKey {
  type: KeyType;
  /** NEAR text form, e.g. "ml-dsa-65:<base58>". */
  text: string;
  /** Short form for screens: the ML-DSA handle, or the key text itself for classical keys. */
  handle: string;
}

export type DecodedPermission =
  | { kind: "full" }
  | { kind: "function-call"; allowanceYocto: bigint | null; receiverId: string; methods: string[] };

export type DecodedAction =
  | { kind: "create-account" }
  | { kind: "deploy"; code: Uint8Array }
  | { kind: "call"; method: string; args: Uint8Array; gas: bigint; depositYocto: bigint }
  | { kind: "transfer"; yocto: bigint }
  | { kind: "stake"; yocto: bigint; publicKey: DecodedKey }
  | { kind: "add-key"; publicKey: DecodedKey; nonce: bigint; permission: DecodedPermission }
  | { kind: "delete-key"; publicKey: DecodedKey }
  /** A published global contract the account runs from now, by its 32-byte code hash (by account id: refused). */
  | { kind: "use-global"; codeHash: Uint8Array }
  | { kind: "delete-account"; beneficiaryId: string };

export interface DecodedTx {
  signerId: string;
  publicKey: DecodedKey;
  nonce: bigint;
  receiverId: string;
  blockHash: string;
  actions: DecodedAction[];
}

export class DecodeError extends Error {}

const KEY_TYPES: { type: KeyType; length: number }[] = [
  { type: "ed25519", length: 32 },
  { type: "secp256k1", length: 64 },
  { type: "ml-dsa-65", length: 1952 },
];

class Reader {
  private offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number) {
    if (this.offset + n > this.bytes.length) throw new DecodeError("the transaction ends too early");
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.offset++];
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) | lo;
  }
  fixed(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  vec(): Uint8Array {
    return this.fixed(this.u32());
  }
  string(): string {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.vec());
    } catch (e) {
      if (e instanceof DecodeError) throw e;
      throw new DecodeError("a name in the transaction isn't valid text");
    }
  }
  list<T>(item: () => T): T[] {
    const n = this.u32();
    if (n > 1000) throw new DecodeError("too many items in the transaction");
    return Array.from({ length: n }, item);
  }
  done() {
    if (this.offset !== this.bytes.length) throw new DecodeError("extra bytes after the transaction");
  }
}

function readKey(r: Reader): DecodedKey {
  const tag = r.u8();
  const kind = KEY_TYPES[tag];
  if (!kind) throw new DecodeError(`unknown key type ${tag}`);
  const text = `${kind.type}:${base58Encode(r.fixed(kind.length))}`;
  return { type: kind.type, text, handle: kind.type === "ml-dsa-65" ? mlDsaKeyHandle(text) : text };
}

function readPermission(r: Reader): DecodedPermission {
  const tag = r.u8();
  if (tag === 0) {
    const allowanceYocto = r.u8() === 1 ? r.u128() : null;
    return { kind: "function-call", allowanceYocto, receiverId: r.string(), methods: r.list(() => r.string()) };
  }
  if (tag === 1) return { kind: "full" };
  // 2 and 3 are gas keys. ZeroFee never adds them, so they are refused rather than half-explained.
  throw new DecodeError(`unsupported key permission ${tag}`);
}

function readAction(r: Reader): DecodedAction {
  const tag = r.u8();
  switch (tag) {
    case 0:
      return { kind: "create-account" };
    case 1:
      return { kind: "deploy", code: r.vec() };
    case 2:
      return { kind: "call", method: r.string(), args: r.vec(), gas: r.u64(), depositYocto: r.u128() };
    case 3:
      return { kind: "transfer", yocto: r.u128() };
    case 4:
      return { kind: "stake", yocto: r.u128(), publicKey: readKey(r) };
    case 5:
      return { kind: "add-key", publicKey: readKey(r), nonce: r.u64(), permission: readPermission(r) };
    case 6:
      return { kind: "delete-key", publicKey: readKey(r) };
    case 7:
      return { kind: "delete-account", beneficiaryId: r.string() };
    case 10: {
      // A global contract by its code hash (0); one by account id (1) can change under the account: refused.
      const by = r.u8();
      if (by !== 0) throw new DecodeError("a global contract named by an account, not its code");
      return { kind: "use-global", codeHash: r.fixed(32) };
    }
    default:
      // 8 delegate, 9 and 11 global contract publishing and state init, 12–13 gas keys: not something ZeroFee signs.
      throw new DecodeError(`unsupported action ${tag}`);
  }
}

/** Decode a (version 0) NEAR transaction exactly as it will be hashed and signed. */
export function decodeTransaction(bytes: Uint8Array): DecodedTx {
  const r = new Reader(bytes);
  const signerId = r.string();
  const publicKey = readKey(r);
  const nonce = r.u64();
  const receiverId = r.string();
  const blockHash = toBase58(r.fixed(32));
  const actions = r.list(() => readAction(r));
  r.done();
  if (actions.length === 0) throw new DecodeError("a transaction with no steps");
  return { signerId, publicKey, nonce, receiverId, blockHash, actions };
}
