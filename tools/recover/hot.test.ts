// The hot wallets' way out (hot.ts): from the words alone, the same wallets the phone's core makes, at the paths
// docs/ESCAPE.md gives, and each key in a form that opens that very address. Words: BIP-39's public all-zero test words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { evmAddress } from "../../packages/core/src/evm.ts";
import { hotRoot, hotSecret } from "../../packages/core/src/hot-keys.ts";
import { wordsToSeed } from "../../packages/core/src/recovery-words.ts";
import { base58, fromBase58 } from "../../packages/core/src/sol/bytes.ts";
import { hotKey, hotWallets } from "./hot.ts";

const WORDS = [...Array(23).fill("abandon"), "art"];

test("every wallet ZeroFee makes from the words, at the paths ESCAPE.md gives, the same as the core's", () => {
  const list = hotWallets(WORDS);
  assert.equal(list.length, 23, "Trading's balance, Private, 5 trading wallets on each of 3 chains, 5 Browser wallets, the card's");
  const at = (kind: string, chain: string, slot = 0) => list.find((w) => w.kind === kind && w.chain === chain && w.slot === slot)!;
  assert.deepEqual(
    [at("trade", "near").path, at("private", "near").path, at("trade", "sol", 2).path, at("trade", "bsc", 4).path, at("browser", "eth").path, at("browser", "sol").path, at("pay", "gnosis").path],
    ["m/44'/397'/0'", "m/44'/397'/48'", "m/44'/501'/2'/0'", "m/44'/60'/0'/0/4", "m/44'/60'/18'/0/0", "m/44'/501'/16'/0'", "m/44'/60'/36'/0/0"],
  );
  const root = hotRoot(wordsToSeed(WORDS));
  for (const w of list) {
    const secret = hotSecret(root, w.kind, w.chain, w.slot)!;
    const want = w.chain === "sol" ? base58(ed25519.getPublicKey(secret)) : w.chain === "near" ? Buffer.from(ed25519.getPublicKey(secret)).toString("hex") : evmAddress(secret);
    assert.equal(w.address, want, w.name);
  }
  assert.equal(new Set(list.map((w) => w.address)).size, 23, "no two share an address");
});

test("each key opens that very address, in the form wallets import", () => {
  const sol = hotKey(WORDS, "trade", "sol", 1);
  const pair = fromBase58(sol.secretKey);
  assert.equal(pair.length, 64);
  assert.equal(base58(ed25519.getPublicKey(pair.slice(0, 32))), sol.wallet.address);
  const evm = hotKey(WORDS, "browser", "base");
  assert.match(evm.secretKey, /^0x[0-9a-f]{64}$/);
  assert.equal(evmAddress(Uint8Array.from(Buffer.from(evm.secretKey.slice(2), "hex"))), evm.wallet.address);
  const near = hotKey(WORDS, "private", "near");
  assert.match(near.secretKey, /^ed25519:/);
  assert.equal(Buffer.from(fromBase58(near.secretKey.slice(8)).slice(32)).toString("hex"), near.wallet.address);
  assert.throws(() => hotKey(WORDS, "private", "sol"), /no private wallet on sol/);
  assert.throws(() => hotWallets([...WORDS.slice(0, 23), "zoo"]), /recovery words rejected/);
});
