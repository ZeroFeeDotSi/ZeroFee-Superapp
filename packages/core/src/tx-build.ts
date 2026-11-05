// Building the exact bytes to sign, and checking them against what was asked.
//
// Apps describe what they want as a TxRequest (signer.ts). Only `transfer` and `call` steps are accepted from apps; key
// changes and contract installs come from the security layer itself. Every amount is a whole number in text, checked
// here, never parsed loosely. After building, the bytes are decoded by tx-decode.ts (a separate implementation) and
// `sameTransaction` must hold, or nothing is signed.
import { bytesToBase64, serializeSignedTransaction, serializeTransaction } from "@fastnear/utils";
import type { TxRequest } from "./signer.ts";
import { releaseTxBytes, signedBytes } from "./tx-borsh.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

export type KeyPermission =
  | { kind: "full" }
  | { kind: "function-call"; receiverId: string; methods: string[]; allowanceYocto: bigint | null };

export type CoreAction =
  | { kind: "transfer"; yocto: bigint }
  | { kind: "call"; method: string; args: Uint8Array; gas: bigint; depositYocto: bigint }
  | { kind: "deploy"; code: Uint8Array }
  | { kind: "add-key"; publicKey: string; permission: KeyPermission }
  | { kind: "delete-key"; publicKey: string }
  /** The account runs a published global contract, named by its 32-byte code hash (set-up by hash, the contract review's FI-2). */
  | { kind: "use-global"; codeHash: Uint8Array };

export interface UnsignedTx {
  signerId: string;
  /** NEAR text form of the signing key. */
  publicKey: string;
  nonce: bigint;
  receiverId: string;
  /** Base58 hash of a recent final block. */
  blockHash: string;
  actions: CoreAction[];
}

export class RequestError extends Error {}

const U128_MAX = (1n << 128n) - 1n;
/** NEAR's prepaid-gas limit for one transaction: 300 Tgas. */
export const MAX_GAS = 300_000_000_000_000n;
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const METHOD = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const MAX_STEPS = 10;

export function isAccountId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 2 && id.length <= 64 && ACCOUNT_ID.test(id);
}

/** A whole number written as text (e.g. yoctoNEAR or gas). Never a float, never a unit suffix. */
function wholeNumber(value: unknown, what: string, max = U128_MAX): bigint {
  if (typeof value !== "string" || !/^\d{1,39}$/.test(value)) throw new RequestError(`${what} must be a whole number written as text`);
  const n = BigInt(value);
  if (n > max) throw new RequestError(`${what} is too large`);
  return n;
}

/** An app's request → the steps to build. Throws RequestError (shown as security.request.invalid) on anything odd. */
export function actionsFromRequest(request: TxRequest): CoreAction[] {
  if (!request || typeof request !== "object") throw new RequestError("there is no request");
  if (!isAccountId(request.receiverId)) throw new RequestError("the receiver isn't a NEAR account name");
  if (!Array.isArray(request.actions) || request.actions.length === 0) throw new RequestError("the request has no steps");
  if (request.actions.length > MAX_STEPS) throw new RequestError(`a request can have at most ${MAX_STEPS} steps`);
  const actions = request.actions.map((a, i): CoreAction => {
    const step = `step ${i + 1}`;
    if (a?.kind === "transfer") return { kind: "transfer", yocto: wholeNumber(a.yocto, `${step}'s amount`) };
    if (a?.kind === "call") {
      if (typeof a.method !== "string" || !METHOD.test(a.method)) throw new RequestError(`${step} has no valid method name`);
      if (!a.args || typeof a.args !== "object" || Array.isArray(a.args)) throw new RequestError(`${step}'s details must be an object`);
      let json: string;
      try {
        json = JSON.stringify(a.args);
      } catch {
        throw new RequestError(`${step}'s details can't be written as JSON`);
      }
      const gas = wholeNumber(a.gas, `${step}'s gas`, MAX_GAS);
      if (gas === 0n) throw new RequestError(`${step} needs some gas`);
      return { kind: "call", method: a.method, args: new TextEncoder().encode(json), gas, depositYocto: wholeNumber(a.depositYocto, `${step}'s deposit`) };
    }
    throw new RequestError(`${step} isn't a transfer or a call`);
  });
  const gas = actions.reduce((sum, a) => sum + (a.kind === "call" ? a.gas : 0n), 0n);
  if (gas > MAX_GAS) throw new RequestError("the steps together ask for more than 300 Tgas");
  return actions;
}

function toLibraryAction(a: CoreAction): Record<string, unknown> {
  switch (a.kind) {
    case "transfer":
      return { type: "Transfer", deposit: a.yocto };
    case "call":
      return { type: "FunctionCall", methodName: a.method, argsBase64: bytesToBase64(a.args), gas: a.gas, deposit: a.depositYocto };
    case "deploy":
      return { type: "DeployContract", codeBase64: bytesToBase64(a.code) };
    case "add-key":
      return {
        type: "AddKey",
        publicKey: a.publicKey,
        accessKey:
          a.permission.kind === "full"
            ? { nonce: 0, permission: "FullAccess" }
            : { nonce: 0, permission: { receiverId: a.permission.receiverId, methodNames: a.permission.methods, allowance: a.permission.allowanceYocto } },
      };
    case "delete-key":
      return { type: "DeleteKey", publicKey: a.publicKey };
    case "use-global":
      throw new Error("the library can't write a global contract's use: tx-borsh.ts does");
  }
}

/** A transaction the library can't write (a global contract by hash): the core's own writer, the same bytes otherwise. */
const ownWriter = (tx: UnsignedTx) => tx.actions.some((a) => a.kind === "use-global");

function toLibraryTx(tx: UnsignedTx) {
  return { signerId: tx.signerId, publicKey: tx.publicKey, nonce: tx.nonce, receiverId: tx.receiverId, blockHash: tx.blockHash, actions: tx.actions.map(toLibraryAction) } as any;
}

/** The exact bytes whose sha256 is signed. */
export function serialize(tx: UnsignedTx): Uint8Array {
  if (ownWriter(tx)) return releaseTxBytes(tx);
  return new Uint8Array(serializeTransaction(toLibraryTx(tx)));
}

/** The signed transaction, base64, ready for the `send_tx` RPC. */
export function signedBase64(tx: UnsignedTx, signature: Uint8Array): string {
  if (ownWriter(tx)) return bytesToBase64(signedBytes(releaseTxBytes(tx), tx.publicKey, signature));
  return bytesToBase64(new Uint8Array(serializeSignedTransaction(toLibraryTx(tx), signature)));
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function sameAction(d: DecodedAction, a: CoreAction): boolean {
  switch (a.kind) {
    case "transfer":
      return d.kind === "transfer" && d.yocto === a.yocto;
    case "call":
      return d.kind === "call" && d.method === a.method && sameBytes(d.args, a.args) && d.gas === a.gas && d.depositYocto === a.depositYocto;
    case "deploy":
      return d.kind === "deploy" && sameBytes(d.code, a.code);
    case "delete-key":
      return d.kind === "delete-key" && d.publicKey.text === a.publicKey;
    case "use-global":
      return d.kind === "use-global" && sameBytes(d.codeHash, a.codeHash);
    case "add-key": {
      if (d.kind !== "add-key" || d.publicKey.text !== a.publicKey || d.nonce !== 0n) return false;
      const p = a.permission;
      const q = d.permission;
      if (p.kind === "full") return q.kind === "full";
      return (
        q.kind === "function-call" &&
        q.receiverId === p.receiverId &&
        q.allowanceYocto === p.allowanceYocto &&
        q.methods.length === p.methods.length &&
        q.methods.every((m, i) => m === p.methods[i])
      );
    }
  }
}

/** True only if the decoded bytes are exactly the transaction that was built. Anything else: refuse to sign. */
export function sameTransaction(decoded: DecodedTx, tx: UnsignedTx): boolean {
  return (
    decoded.signerId === tx.signerId &&
    decoded.publicKey.text === tx.publicKey &&
    decoded.nonce === tx.nonce &&
    decoded.receiverId === tx.receiverId &&
    decoded.blockHash === tx.blockHash &&
    decoded.actions.length === tx.actions.length &&
    decoded.actions.every((d, i) => sameAction(d, tx.actions[i]))
  );
}
