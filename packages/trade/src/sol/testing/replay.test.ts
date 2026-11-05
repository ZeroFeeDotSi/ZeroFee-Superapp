// TEST_OWNER is no one's wallet: it derives from BIP-39's public test phrase, so every fixture recorded for it is public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519.js";
import { slip10Ed25519 } from "@zerofee/core/hot-keys";
import { base58 } from "../bytes.ts";
import { TEST_OWNER } from "./replay.ts";

test("TEST_OWNER is BIP-39's public test phrase at m/44'/501'/0'/1' (control: m/44'/501'/0'/0' is another address)", () => {
  const seed = mnemonicToSeedSync("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"); // BIP-39's public test vector: zerofee-allow-secret-shape
  assert.equal(base58(ed25519.getPublicKey(slip10Ed25519(seed, [44, 501, 0, 1]))), TEST_OWNER);
  assert.notEqual(base58(ed25519.getPublicKey(slip10Ed25519(seed, [44, 501, 0, 0]))), TEST_OWNER);
});
