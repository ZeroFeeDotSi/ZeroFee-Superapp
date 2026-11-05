// Request money starts on test NEAR on the test network at once, never after a balance read (grade 02h, H2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { onTestNetwork, startCoin, testAccountFix } from "./request-coin.ts";

test("the test network starts on NEAR, before anything is read", () => {
  assert.equal(startCoin("", false), "NEAR", "the real app (testnet)");
  assert.equal(startCoin("?chatrelay=ws://127.0.0.1:7787", false), "NEAR");
  assert.equal(startCoin("?demo", false), "NEAR", "the ?demo's sample account is a testnet one");
  assert.ok(onTestNetwork("?laptop", false));
});

test("mainnet starts on USDC: ?mainnet, the phone's mainnet build, and every page of the public build", () => {
  assert.equal(startCoin("?mainnet", false), "USDC");
  assert.equal(startCoin("?mainnet&chatrelay=ws://127.0.0.1:7787", false), "USDC");
  assert.equal(startCoin("", true), "USDC");
  assert.equal(startCoin("?demo", true), "USDC", "the public demo is mainnet-shaped");
  assert.equal(onTestNetwork("?mainnetx", false), true, "only the switch itself, never a word that contains it");
});

test("a test account's refusal names the field to change", () => {
  assert.equal(testAccountFix({ coin: "USDC", network: "Base" }), "The coin says USDC. Change it to NEAR.");
  assert.equal(testAccountFix({ coin: "NEAR", network: "Solana" }), "The network says Solana. Change it to NEAR.");
  assert.equal(testAccountFix({ coin: "", network: "NEAR" }), "The coin says nothing. Change it to NEAR.");
});
