// The trading wallet's keys. One random 32-byte seed is the whole secret; each chain's key comes from it by HKDF with
// the chain's own label, so one sealed blob (and one link code) covers every chain, and no two chains share a key.
// Nothing here checks what a transaction does: the vault runs policy.ts first and only then calls signSolTx.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64, fromBase64, utf8 } from "@zerofee/trade/sol/bytes.ts";
import { decodeTx } from "@zerofee/trade/sol/tx.ts";

export const SEED_BYTES = 32;

export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

/** The Solana key: the 32-byte ed25519 secret (the first half of what Solana wallets export) and its address. */
export function solanaKey(seed: Uint8Array): { secret: Uint8Array; address: string } {
  if (seed.length !== SEED_BYTES) throw new Error("the seed is 32 bytes");
  const secret = hkdf(sha256, seed, utf8("zerofee-extension"), utf8("solana/0"), 32);
  return { secret, address: base58(ed25519.getPublicKey(secret)) };
}

/** Puts this wallet's signature into its slot of a serialised transaction (base64) and returns it. */
export function signSolTx(txB64: string, seed: Uint8Array): string {
  const { secret, address } = solanaKey(seed);
  try {
    const tx = decodeTx(txB64);
    const slot = tx.staticKeys.indexOf(address);
    if (slot < 0 || slot >= tx.header[0]) throw new Error("this wallet doesn't sign that transaction");
    const bytes = fromBase64(txB64);
    const at = bytes.length - tx.message.length - 64 * tx.signatures.length + 64 * slot;
    bytes.set(ed25519.sign(tx.message, secret), at);
    return base64(bytes);
  } finally {
    secret.fill(0);
  }
}
