// The hot wallets' way out without ZeroFee (docs/ESCAPE.md): from the 24 words alone, every separate wallet ZeroFee
// makes from them (Trading's wallets and balance, Private, the Browser's and the card's), each chain's standard
// derivation under ZeroFee's passphrase (packages/core/src/hot-keys.ts), and the key of one of them in the form other
// wallets import. The same code as the phone's core, so it finds exactly the wallets ZeroFee made.
import { ed25519 } from "@noble/curves/ed25519.js";
import { HOT_PASSPHRASE, hotPath, hotRoot, hotSecret } from "../../packages/core/src/hot-keys.ts";
import { evmAddress } from "../../packages/core/src/evm.ts";
import { wordsToSeed } from "../../packages/core/src/recovery-words.ts";
import { solAddress } from "../../packages/core/src/solana.ts";
import { base58 } from "../../packages/core/src/sol/bytes.ts";

export { HOT_PASSPHRASE };

export interface HotWallet {
  kind: string;
  chain: string;
  slot: number;
  /** As a person reads it: "Trading wallet 2 · Solana". */
  name: string;
  path: string;
  address: string;
}

const CHAIN: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", near: "NEAR", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };
const SLOTS = 5;

/** Every separate wallet ZeroFee makes from these words, in the order the app lists them. */
const PLACES: { kind: string; chain: string; slot: number; name: string }[] = [
  { kind: "trade", chain: "near", slot: 0, name: "Trading balance" },
  { kind: "private", chain: "near", slot: 0, name: "Private pocket" },
  ...(["sol", "bsc", "hood"] as const).flatMap((chain) => Array.from({ length: SLOTS }, (_, slot) => ({ kind: "trade", chain, slot, name: `Trading wallet ${slot + 1}` }))),
  ...(["sol", "eth", "base", "gnosis", "arb"] as const).map((chain) => ({ kind: "browser", chain, slot: 0, name: "Browser wallet" })),
  { kind: "pay", chain: "gnosis", slot: 0, name: "Card wallet" },
];

const address = (chain: string, secret: Uint8Array) =>
  chain === "sol" ? solAddress(secret) : chain === "near" ? Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("") : evmAddress(secret);

/** The 24 words checked (a typo or a wrong checksum throws), then the hot root. */
function root(words: readonly string[]): Uint8Array {
  return hotRoot(wordsToSeed(words));
}

export function hotWallets(words: readonly string[]): HotWallet[] {
  const r = root(words);
  return PLACES.map((p) => {
    const secret = hotSecret(r, p.kind, p.chain, p.slot)!;
    return { ...p, name: `${p.name} · ${CHAIN[p.chain]}`, path: hotPath(p.kind, p.chain, p.slot)!.path, address: address(p.chain, secret) };
  });
}

/**
 * One wallet's key, as other wallets import it (the same as ZeroFee's "Show its key"): Solana's 64-byte keypair in
 * base58 (Phantom, Solflare, solana-keygen), an EVM private key as 0x hex (MetaMask, Rabby), NEAR's ed25519:<base58>.
 */
export function hotKey(words: readonly string[], kind: string, chain: string, slot = 0): { wallet: HotWallet; secretKey: string } {
  const place = PLACES.find((p) => p.kind === kind && p.chain === chain && p.slot === slot);
  if (!place) throw new Error(`ZeroFee makes no ${kind} wallet on ${chain}${slot ? ` at ${slot + 1}` : ""}`);
  const secret = hotSecret(root(words), kind, chain, slot)!;
  const pair = () => base58(new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]));
  const secretKey = chain === "near" ? `ed25519:${pair()}` : chain === "sol" ? pair() : `0x${Array.from(secret, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { wallet: hotWallets(words).find((w) => w.kind === kind && w.chain === chain && w.slot === slot)!, secretKey };
}
