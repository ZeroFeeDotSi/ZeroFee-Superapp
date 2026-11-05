// The hot wallets' keys come from the backup words, so restoring the words brings them back (design review, 28 Oct; the
// journey map found a restore lost Trading's money). Each chain's standard derivation is used, so any of these wallets
// can be opened in another wallet without ZeroFee (docs/ESCAPE.md): BIP-39's seed from the 24 words with ZeroFee's own
// passphrase, then SLIP-10 (ed25519: Solana, NEAR) or BIP-32 (secp256k1: EVM) along a BIP-44 path. The passphrase means
// typing the words into another wallet alone opens none of them (the words' own key is the main account's recovery key,
// kept behind its wait).
//
// What this costs, said plainly: whoever has the words can make these keys at once, so the hot money (Trading, the
// trading wallets, Private, the Browser and card wallets) is theirs at once; the main balance stays behind its wait.
//
// Paths (the account level keeps kinds and chains apart, so no two wallets share a key or an address):
//   Solana  m/44'/501'/(16·kind + slot)'/0'        kind: trade 0, browser 1, pay 2, site 4 (slot = the site's index)
//   EVM     m/44'/60'/(16·kind + chain)'/0/slot    chain: bsc 0, hood 1, eth 2, base 3, gnosis 4, arb 5
//   NEAR    m/44'/397'/(16·kind)'                  kind: trade 0 (Trading's balance), browser 1 (the NEAR coin wallet:
//                                                  public, Rhea trades, 3 Nov), private 3 (the pocket), agent 5
// Any other connected site's own wallet (kind "host", audit C1, 3 Nov): Solana m/44'/501'/1000'/<host index>', EVM
// m/44'/60'/(1000 + chain)'/0/<host index>: the host index is site-wallets.ts hostIndex (31 bits of a hash of the host),
// so the same words and the same host make the same wallet, and account 1000+ is apart from every kind above.
// AgentZero's own wallet (kind agent 5, AGENTZERO-WALLET.md §1): NEAR m/44'/397'/80' (its confidential USDC) and its
// Solana leg m/44'/501'/80'/0', slot 0 only and no EVM; apart from trade, private, every row and every site (site 4's
// slots end at 79').
// The Extension's wallet is made on the laptop, so it isn't among them.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { seedToWords } from "./recovery-words.ts";
import { utf8 } from "./sol/bytes.ts";

/** BIP-39's passphrase for the hot wallets: public and fixed; it only keeps them apart from the words' own key. */
export const HOT_PASSPHRASE = "ZeroFee hot wallets v1";
/** The vault item that holds the hot root on this device (made at set-up or restore, while the words are here). */
export const HOT_ROOT = "hot-root";

const HARDENED = 0x80000000;
// "site": a site's own wallet (site-wallets.ts), its slot the site's fixed index.
// "agent": AgentZero's own wallet (agent-wallet.ts), never a Home row.
const KIND_INDEX: Record<string, number> = { trade: 0, browser: 1, pay: 2, private: 3, site: 4, agent: 5 };
const EVM_INDEX: Record<string, number> = { bsc: 0, hood: 1, eth: 2, base: 3, gnosis: 4, arb: 5 };

/** The hot root: BIP-39's 64-byte seed from the 24 words (their 32 bytes) with ZeroFee's passphrase. */
export function hotRoot(wordsSeed: Uint8Array): Uint8Array {
  return mnemonicToSeedSync(seedToWords(wordsSeed).join(" "), HOT_PASSPHRASE);
}

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};
const big = (b: Uint8Array) => BigInt(`0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") || "0"}`);
const bytes32 = (n: bigint) => {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
};

/** SLIP-10 for ed25519: hardened steps only. `path` holds the plain indices; each is hardened here. */
export function slip10Ed25519(seed: Uint8Array, path: readonly number[]): Uint8Array {
  let i = hmac(sha512, utf8("ed25519 seed"), seed);
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error("a SLIP-10 index is 0 to 2^31 - 1");
    i = hmac(sha512, i.slice(32), cat(new Uint8Array([0]), i.slice(0, 32), u32(index + HARDENED)));
  }
  return i.slice(0, 32);
}

/** BIP-32 for secp256k1 (private derivation). `path`: each step's index and whether it is hardened. */
export function bip32Secp256k1(seed: Uint8Array, path: readonly { index: number; hardened: boolean }[]): Uint8Array {
  const n = secp256k1.Point.CURVE().n;
  let i = hmac(sha512, utf8("Bitcoin seed"), seed);
  let key = big(i.slice(0, 32));
  if (key === 0n || key >= n) throw new Error("this seed makes no BIP-32 key");
  let chain = i.slice(32);
  for (const step of path) {
    if (!Number.isInteger(step.index) || step.index < 0 || step.index >= HARDENED) throw new Error("a BIP-32 index is 0 to 2^31 - 1");
    const index = step.hardened ? step.index + HARDENED : step.index;
    const data = step.hardened ? cat(new Uint8Array([0]), bytes32(key)) : secp256k1.getPublicKey(bytes32(key), true);
    i = hmac(sha512, chain, cat(data, u32(index)));
    const left = big(i.slice(0, 32));
    const child = (left + key) % n;
    // BIP-32: such an index makes no key (odds about 1 in 2^127); a wallet never gets one, so this is refused, not skipped.
    if (left >= n || child === 0n) throw new Error("this index makes no BIP-32 key");
    key = child;
    chain = i.slice(32);
  }
  return bytes32(key);
}

/** Where a hot wallet's key comes from, as a BIP-44 path, or null for one the words don't make (the Extension's). */
export function hotPath(kind: string, chain: string, slot = 0): { curve: "ed25519" | "secp256k1"; path: string; steps: { index: number; hardened: boolean }[] } | null {
  if (kind === "host") {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HARDENED) return null;
    const hh = (index: number) => ({ index, hardened: true });
    const hs = chain === "sol" ? [hh(44), hh(501), hh(1000), hh(slot)] : EVM_INDEX[chain] !== undefined ? [hh(44), hh(60), hh(1000 + EVM_INDEX[chain]!), { index: 0, hardened: false }, { index: slot, hardened: false }] : null;
    if (!hs) return null;
    return { curve: chain === "sol" ? "ed25519" : "secp256k1", steps: hs, path: `m/${hs.map((s) => `${s.index}${s.hardened ? "'" : ""}`).join("/")}` };
  }
  const k = KIND_INDEX[kind];
  if (k === undefined || !Number.isInteger(slot) || slot < 0 || slot >= 16) return null;
  // AgentZero's wallet is one key a chain: NEAR (its USDC) and Solana (its trading leg), slot 0, nothing else.
  if (kind === "agent" && (slot !== 0 || (chain !== "near" && chain !== "sol"))) return null;
  const h = (index: number) => ({ index, hardened: true });
  let steps: { index: number; hardened: boolean }[];
  let curve: "ed25519" | "secp256k1" = "ed25519";
  if (chain === "sol" && kind !== "private") steps = [h(44), h(501), h(16 * k + slot), h(0)];
  else if (chain === "near" && (kind === "trade" || kind === "browser" || kind === "private" || kind === "agent") && slot === 0) steps = [h(44), h(397), h(16 * k)];
  else if (EVM_INDEX[chain] !== undefined && kind !== "private") {
    curve = "secp256k1";
    steps = [h(44), h(60), h(16 * k + EVM_INDEX[chain]!), { index: 0, hardened: false }, { index: slot, hardened: false }];
  } else return null;
  return { curve, steps, path: `m/${steps.map((s) => `${s.index}${s.hardened ? "'" : ""}`).join("/")}` };
}

/** A hot wallet's secret from the hot root: the ed25519 seed (Solana, NEAR) or the secp256k1 key (EVM). Null if not made from the words. */
export function hotSecret(root: Uint8Array, kind: string, chain: string, slot = 0): Uint8Array | null {
  const p = hotPath(kind, chain, slot);
  if (!p) return null;
  return p.curve === "ed25519" ? slip10Ed25519(root, p.steps.map((s) => s.index)) : bip32Secp256k1(root, p.steps);
}
