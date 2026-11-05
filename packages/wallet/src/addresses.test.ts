import { test } from "node:test";
import assert from "node:assert/strict";
import { validAddress, validEvmAddress, validReceiveAddress, validSolanaAddress } from "./addresses.ts";
import { RECORDED } from "./testing/replay.ts";

test("Ethereum-style addresses: right length, hex, and the EIP-55 checksum when the case is mixed", () => {
  assert.ok(validEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), "EIP-55's own example");
  assert.ok(validEvmAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "all lower case");
  assert.ok(validEvmAddress("0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
  assert.ok(!validEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), "one letter's case is wrong");
  assert.ok(!validEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA"), "too short");
  assert.ok(!validEvmAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), "no 0x");
  assert.ok(!validEvmAddress("0xZZAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"));
});

test("Solana addresses are 32 bytes of base58", () => {
  assert.ok(validSolanaAddress("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"));
  assert.ok(validSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"));
  assert.ok(!validSolanaAddress("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjR0"), "0 isn't base58");
  assert.ok(!validSolanaAddress("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5"), "too short");
  assert.ok(!validSolanaAddress("0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
});

test("a network without a check can't be sent to", () => {
  assert.ok(validAddress("hood", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
  assert.ok(validAddress("sol", "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"));
  assert.ok(!validAddress("sol", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"), "an EVM address on Solana");
  assert.ok(!validAddress("btc", "bc1qlcwnxxf6q3ppkhkfl069e609h6ly3uzs0epyx3"), "not checked yet, so not offered");
});

test("W-4: a receive address is checked for its own network, checksum and all", () => {
  const good: [string, string][] = [
    // the deposit bridge's own answers (fixtures/bridge-deposit-addresses.json)
    ["sol", RECORDED.addresses.addresses["sol:mainnet SIMPLE"].result.address],
    ["base", RECORDED.addresses.addresses["eth:8453 SIMPLE"].result.address],
    ["hood", RECORDED.addresses.addresses["eth:4663 SIMPLE"].result.address],
    ["btc", RECORDED.addresses.addresses["btc:mainnet SIMPLE"].result.address],
    ["tron", RECORDED.addresses.addresses["tron:mainnet SIMPLE"].result.address],
    ["xrp", RECORDED.addresses.addresses["xrp:mainnet SIMPLE"].result.address],
    ["ton", RECORDED.addresses.addresses["ton:mainnet SIMPLE"].result.address],
    ["stellar", RECORDED.addresses.addresses["stellar:mainnet MEMO"].result.address],
    // well-known ones
    ["btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"],
    ["tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
    ["xrp", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"],
  ];
  for (const [chain, a] of good) {
    assert.ok(validReceiveAddress(chain, a), `${chain} ${a}`);
    // one character changed: the checksum catches it (a Solana key has none: any 32 bytes is an address)
    if (chain === "sol") continue;
    const i = a.length - 3, swapped = a.slice(0, i) + (a[i] === "2" ? "3" : "2") + a.slice(i + 1);
    assert.ok(!validReceiveAddress(chain, swapped), `${chain} ${swapped} (one character changed)`);
  }
  assert.ok(!validReceiveAddress("bsc", RECORDED.addresses.addresses["sol:mainnet SIMPLE"].result.address), "a Solana address on BNB Chain");
  assert.ok(!validReceiveAddress("btc", RECORDED.addresses.addresses["eth:8453 SIMPLE"].result.address), "an EVM address on Bitcoin");
  assert.ok(!validReceiveAddress("sol", ` ${RECORDED.addresses.addresses["sol:mainnet SIMPLE"].result.address}`), "padded");
  assert.ok(!validReceiveAddress("qtc", "anything"), "a network without a check shows no address");
});

test("D47: fomo left Apps, so a fomo deposit address (a plain Solana address) is paid with Wallet's Send", () => {
  assert.equal(validAddress("sol", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), true);
  assert.equal(validAddress("sol", "0x7D06e272b5305a4b9D40e872C7950D3437547e3D"), false, "fomo's Base deposit is the wrong network here");
});
