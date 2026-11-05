// The unsigned EIP-1559 transaction a step hands the trade service: 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
// maxFeePerGas, gasLimit, to, value, data, accessList]), base64. The same bytes viem's serializeTransaction makes
// (tx.test.ts checks it on random transactions). Nothing here signs: the trade service signs these bytes and sends the
// signed form back through the engine's send().
import { base64, bigBytes, cat, fromHex, keccakHex, type Hex } from "./bytes.ts";
import { rlpEncode, type Rlp } from "./rlp.ts";
import type { Eip1559, Signature } from "./wire.ts";
export { parseTx, type Eip1559, type Signature } from "./wire.ts";

const fields = (t: Eip1559): Rlp[] => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(t.to)) throw new Error("tx: `to` is not an address");
  if (!(Number.isSafeInteger(t.chainId) && t.chainId > 0 && Number.isSafeInteger(t.nonce) && t.nonce >= 0)) throw new Error("tx: bad chainId or nonce");
  if (t.maxPriorityFeePerGas > t.maxFeePerGas) throw new Error("tx: tip above the fee cap");
  return [bigBytes(BigInt(t.chainId)), bigBytes(BigInt(t.nonce)), bigBytes(t.maxPriorityFeePerGas), bigBytes(t.maxFeePerGas), bigBytes(t.gas), fromHex(t.to), bigBytes(t.value), fromHex(t.data), []];
};

/** The bytes a wallet signs (keccak of these is the signing hash) and the trade service carries, base64. */
export const unsignedBytes = (t: Eip1559): Uint8Array => cat(Uint8Array.of(2), rlpEncode(fields(t)));
export const unsignedTx = (t: Eip1559): string => base64(unsignedBytes(t));
/** A signed EIP-1559 transaction (only for tests and for reading back what was sent). */
export const signedBytes = (t: Eip1559, sig: Signature): Uint8Array => cat(Uint8Array.of(2), rlpEncode([...fields(t), bigBytes(BigInt(sig.yParity)), bigBytes(sig.r), bigBytes(sig.s)]));

/** A signed transaction's hash: keccak of its bytes. */
export const txHashOf = (signed: Uint8Array): Hex => keccakHex(signed);
