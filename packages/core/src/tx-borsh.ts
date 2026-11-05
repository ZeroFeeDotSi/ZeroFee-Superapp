// NEAR transactions with the actions @fastnear/utils doesn't write: a global contract published by its code hash, an
// account using one, and an account's deletion (nearcore 2.13.4, core/primitives/src/action/mod.rs: Action 7
// DeleteAccount { beneficiary_id }, 9 DeployGlobalContract { code, deploy_mode: CodeHash = 0 }, 10 UseGlobalContract {
// contract_identifier: CodeHash(CryptoHash) = 0 }). Every other action is written exactly as the library writes it:
// tools/mainnet/release-tx.test.ts compares the bytes with tx-build.ts serialize.
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { bytesToBase64, decodeNearPublicKey, fromBase58 } from "@fastnear/utils";
import type { CoreAction } from "./tx-build.ts";

export type ReleaseAction = CoreAction | { kind: "deploy-global"; code: Uint8Array } | { kind: "delete-account"; beneficiaryId: string };

export interface ReleaseTx {
  signerId: string;
  publicKey: string;
  nonce: bigint;
  receiverId: string;
  blockHash: string;
  actions: ReleaseAction[];
}

class Writer {
  private readonly out: number[] = [];
  u8(x: number) {
    this.out.push(x & 255);
    return this;
  }
  u32(x: number) {
    for (let i = 0; i < 4; i++) this.out.push((x >>> (8 * i)) & 255);
    return this;
  }
  uint(x: bigint, bytes: number) {
    for (let i = 0n; i < BigInt(bytes); i++) this.out.push(Number((x >> (8n * i)) & 255n));
    return this;
  }
  raw(b: Uint8Array) {
    for (const v of b) this.out.push(v);
    return this;
  }
  bytes(b: Uint8Array) {
    return this.u32(b.length).raw(b);
  }
  text(s: string) {
    return this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** A public key as NEAR writes it: its curve's number, then its bytes (ed25519: 32; ML-DSA-65: 1,952). */
export function publicKeyBytes(text: string): Uint8Array {
  if (text.startsWith("ml-dsa-65:")) return Uint8Array.from([2, ...decodePublicKey(text)]);
  if (text.startsWith("ed25519:")) return Uint8Array.from([0, ...decodeNearPublicKey(text).data]);
  throw new Error(`not a key this release uses: ${text.slice(0, 16)}`);
}

function action(w: Writer, a: ReleaseAction): void {
  switch (a.kind) {
    case "transfer":
      w.u8(3).uint(a.yocto, 16);
      return;
    case "call":
      w.u8(2).text(a.method).bytes(a.args).uint(a.gas, 8).uint(a.depositYocto, 16);
      return;
    case "deploy":
      w.u8(1).bytes(a.code);
      return;
    case "add-key": {
      w.u8(5).raw(publicKeyBytes(a.publicKey)).uint(0n, 8);
      if (a.permission.kind === "full") {
        w.u8(1);
        return;
      }
      w.u8(0);
      if (a.permission.allowanceYocto === null) w.u8(0);
      else w.u8(1).uint(a.permission.allowanceYocto, 16);
      w.text(a.permission.receiverId).u32(a.permission.methods.length);
      for (const m of a.permission.methods) w.text(m);
      return;
    }
    case "delete-key":
      w.u8(6).raw(publicKeyBytes(a.publicKey));
      return;
    case "delete-account":
      w.u8(7).text(a.beneficiaryId);
      return;
    case "deploy-global":
      w.u8(9).bytes(a.code).u8(0);
      return;
    case "use-global":
      if (a.codeHash.length !== 32) throw new Error("a code hash is 32 bytes");
      w.u8(10).u8(0).raw(a.codeHash);
      return;
  }
}

/** The unsigned transaction's bytes (what is hashed and signed). */
export function releaseTxBytes(tx: ReleaseTx): Uint8Array {
  const hash = fromBase58(tx.blockHash);
  if (hash.length !== 32) throw new Error("a block hash is 32 bytes");
  const w = new Writer().text(tx.signerId).raw(publicKeyBytes(tx.publicKey)).uint(tx.nonce, 8).text(tx.receiverId).raw(hash).u32(tx.actions.length);
  for (const a of tx.actions) action(w, a);
  return w.done();
}

/** The signed transaction's bytes: the transaction, the key's curve (ed25519 0, ML-DSA-65 2), the signature. */
export function signedBytes(bytes: Uint8Array, publicKey: string, signature: Uint8Array): Uint8Array {
  const ml = publicKey.startsWith("ml-dsa-65:");
  if (signature.length !== (ml ? 3309 : 64)) throw new Error("a signature of the wrong length");
  return Uint8Array.from([...bytes, ml ? 2 : 0, ...signature]);
}

/** The signed transaction, base64, for an ed25519 signer (the release's classical keys). */
export function signedReleaseTx(bytes: Uint8Array, ed25519Signature: Uint8Array): string {
  if (ed25519Signature.length !== 64) throw new Error("an ed25519 signature is 64 bytes");
  return bytesToBase64(Uint8Array.from([...bytes, 0, ...ed25519Signature]));
}
