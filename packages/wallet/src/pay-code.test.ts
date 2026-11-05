import { test } from "node:test";
import assert from "node:assert/strict";
import { payCode } from "./pay-code.ts";

const BASE_ADDR = "0x5a3e0000000000000000000000000000005a3e00";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("an ERC-20 ask is EIP-681's transfer: the token contract, the network's own chain id, the deposit address, smallest units", () => {
  assert.equal(payCode({ chain: "base", address: BASE_ADDR, contract: USDC_BASE, decimals: 6, amount: "2" }), `ethereum:${USDC_BASE}@8453/transfer?address=${BASE_ADDR}&uint256=2000000`);
  assert.equal(payCode({ chain: "eth", address: BASE_ADDR, contract: null, decimals: 18, amount: "0.01" }), `ethereum:${BASE_ADDR}@1?value=10000000000000000`, "the network's own coin: value in wei");
});

test("a Solana ask is Solana Pay: the amount in the coin, and the mint for a token", () => {
  assert.equal(payCode({ chain: "sol", address: SOL_ADDR, contract: USDC_SOL, decimals: 6, amount: "2.50" }), `solana:${SOL_ADDR}?amount=2.5&spl-token=${USDC_SOL}`);
  assert.equal(payCode({ chain: "sol", address: SOL_ADDR, contract: null, decimals: 9, amount: "0.1" }), `solana:${SOL_ADDR}?amount=0.1`);
});

test("anything that doesn't check out is the plain address (null): never a guessed chain id or a malformed code", () => {
  for (const o of [
    { chain: "hood", address: BASE_ADDR, contract: null, decimals: 18, amount: "1" },
    { chain: "near", address: "kid.near", contract: null, decimals: 24, amount: "1" },
    { chain: "base", address: "not-an-address", contract: USDC_BASE, decimals: 6, amount: "2" },
    { chain: "base", address: BASE_ADDR, contract: "nep141:usdc", decimals: 6, amount: "2" },
    { chain: "base", address: BASE_ADDR, contract: USDC_BASE, decimals: 6, amount: "0" },
    { chain: "base", address: BASE_ADDR, contract: USDC_BASE, decimals: 6, amount: "1.0000001" },
    { chain: "sol", address: SOL_ADDR, contract: "0xabc", decimals: 6, amount: "2" },
  ]) assert.equal(payCode(o), null, JSON.stringify(o));
});
