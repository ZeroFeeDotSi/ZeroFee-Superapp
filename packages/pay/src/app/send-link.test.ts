// Another app's send handed to Wallet's Send (ZeroFee Chat, D55): read into a prefill on its one network, the coin
// only when the ledger lists it there, the amount only with its coin; anything else is a Problem, never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prefillFromLink, readSendLink, sendLink } from "./links.ts";
import { TokenDirectory } from "../tokens.ts";

const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const tokens = new TokenDirectory([
  { assetId: "nep141:base-usdc.omft.near", chain: "base", symbol: "USDC", decimals: 6, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", priceUsd: "1", name: "USD Coin", icon: "usdc" },
  { assetId: "nep141:sol-usdc.omft.near", chain: "sol", symbol: "USDC", decimals: 6, contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", priceUsd: "1", name: "USD Coin", icon: "usdc" },
  { assetId: "nep141:wrap.near", chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near", priceUsd: "4", name: "NEAR", icon: "near" },
] as never);

test("a send link round-trips and fills Send in on its one network", () => {
  const link = sendLink({ to: EVM, chain: "base", coin: "USDC", amount: "5", back: "chat" });
  assert.match(link, /^zerofee:send\?v=1&/);
  assert.deepEqual(readSendLink(link), { ok: { to: EVM, chain: "base", coin: "USDC", amount: "5", back: "chat" } });
  const p = prefillFromLink(link, tokens);
  assert.deepEqual(p, { ok: { recipient: { kind: "address", chain: "base", candidates: ["base"], address: EVM }, tokenId: "nep141:base-usdc.omft.near", amount: "5" } });
  const n = prefillFromLink(sendLink({ to: "alice.near", chain: "near", coin: "NEAR", amount: "1" }), tokens);
  assert.ok("ok" in n && n.ok.recipient.kind === "near-wallet" && n.ok.amount === "1");
  // The account's own NEAR row ("near"), never the listed wrapped NEAR no balance row has (grade 02g, G1).
  assert.equal("ok" in n && n.ok.tokenId, "near");
  const t = prefillFromLink(sendLink({ to: "guest-book.testnet", chain: "near", coin: "near", amount: "0.01", back: "chat" }), tokens);
  assert.ok("ok" in t && t.ok.tokenId === "near" && t.ok.amount === "0.01", JSON.stringify(t));
  const m = prefillFromLink(sendLink({ to: SOL, chain: "sol" }), tokens);
  assert.deepEqual(m, { ok: { recipient: { kind: "address", chain: "sol", candidates: ["sol"], address: SOL } } }, "send money: no coin, no amount");
});

test("an amount without a coin the ledger lists there is dropped or refused, never sent in another coin", () => {
  const r = prefillFromLink(sendLink({ to: EVM, chain: "base", coin: "DAI", amount: "5" }), tokens);
  assert.ok("problem" in r && r.problem.code === "pay.code.coin-unsupported", JSON.stringify(r));
  const amountOnly = prefillFromLink("zerofee:send?v=1&to=" + EVM + "&chain=base&amount=5", tokens);
  assert.ok("ok" in amountOnly && amountOnly.ok.amount === undefined);
});

test("a broken or wrong link is a Problem: wrong network for the address, a bad amount, an unknown app to go back to", () => {
  for (const bad of [
    sendLink({ to: SOL, chain: "base" }),
    sendLink({ to: EVM, chain: "sol" }),
    "zerofee:send?v=2&to=" + EVM + "&chain=base",
    "zerofee:send?v=1&to=" + EVM + "&chain=base&amount=1e18",
    "zerofee:send?v=1&to=" + EVM + "&chain=base&back=security",
    "zerofee:send?v=1&chain=base",
  ]) assert.ok("problem" in prefillFromLink(bad, tokens), bad);
  assert.equal(readSendLink("zerofee:pay?v=1&to=alice.near"), null, "a request link is not a send link");
});

test("D111 (C-4): Chat's send to an address on Robinhood Chain fills Send in; a non-EVM address there is refused", () => {
  const p = prefillFromLink(sendLink({ to: EVM, chain: "hood", back: "chat" }), tokens);
  assert.deepEqual(p, { ok: { recipient: { kind: "address", chain: "hood", candidates: ["hood"], address: EVM } } });
  // controls: a Solana address named as Robinhood, and a mistyped capital in the 0x address
  const sol = prefillFromLink(sendLink({ to: SOL, chain: "hood" }), tokens);
  assert.ok("problem" in sol && sol.problem.code === "pay.send.recipient-invalid", JSON.stringify(sol));
  const typo = prefillFromLink(sendLink({ to: EVM.replace("a", "A"), chain: "hood" }), tokens);
  assert.ok("problem" in typo, JSON.stringify(typo));
});
