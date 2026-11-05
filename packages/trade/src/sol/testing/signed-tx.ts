// A real one-transfer Solana transaction with its signature slot filled in (as if the core had signed it), for send tests.
import { base58 } from "../bytes.ts";
import { buildTx, transfer } from "../tx.ts";

export function signedTx(): { signed: string; hash: string; owner: string } {
  const owner = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const bytes = Buffer.from(buildTx(owner, "11111111111111111111111111111111", [transfer(owner, "So11111111111111111111111111111111111111112", 1n)]), "base64");
  bytes.fill(7, 1, 65);
  return { signed: bytes.toString("base64"), hash: base58(new Uint8Array(bytes.subarray(1, 65))), owner };
}
