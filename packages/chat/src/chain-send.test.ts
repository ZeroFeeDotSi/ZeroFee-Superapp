import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_FROM_CHAIN_WALLET, chainWalletSend } from "./chain-send.ts";

test("a chain's own coin goes from the chain wallet (subwallet.send); anything else through the Safe's Send", () => {
  const to = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  assert.deepEqual(chainWalletSend({ chain: "sol", address: to, amount: "0.5", coin: "sol" }), { chain: "sol", to, amount: "0.5" });
  assert.deepEqual(chainWalletSend({ chain: "bsc", address: "0xaa", amount: "1", coin: "BNB" }), { chain: "bsc", to: "0xaa", amount: "1" });
  for (const p of [
    { chain: "sol", address: to, amount: "5", coin: "USDC" },   // not the chain's own coin: the Safe holds it
    { chain: "near", address: "bob.near", amount: "1", coin: "NEAR" }, // no chain wallet on NEAR
    { chain: "sol", address: to, coin: "SOL" },                 // no amount: Send, to type one
    { chain: "sol", address: to, amount: "0", coin: "SOL" },
    { chain: "base", address: "0xaa", amount: "1", coin: "BNB" },
  ]) assert.equal(chainWalletSend(p), null, JSON.stringify(p));
  assert.ok(NOT_FROM_CHAIN_WALLET.has("security.balance.low-coin"), "too little in the chain wallet: the Safe's Send");
});

test("D85: Chat never pays from a chain wallet or the Safe; every send opens the money sheet, from Private only", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /"subwallet\.send"|chainWalletSend|"ledger\.transfer"|"ledger\.pay"/, "no public send from Chat");
  assert.match(app, /shell\.openMoney\(\{ kind: "send", link: sendLink\(\{ to: to\.address[\s\S]*?back: "chat" \}\) \}\)/, "the money sheet, marked as Chat's");
  assert.doesNotMatch(app, /approval\.answer|subwallet\.sign/);
  // control: the old path would be caught
  assert.match('void bridge.call("subwallet.send", ask)', /"subwallet\.send"/);
});
