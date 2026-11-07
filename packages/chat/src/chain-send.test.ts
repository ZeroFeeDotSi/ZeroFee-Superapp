import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_FROM_CHAIN_WALLET } from "./chain-send.ts";

test("Chat's refusal codes: too little in a wallet opens the Safe's Send", () => {
  assert.ok(NOT_FROM_CHAIN_WALLET.has("security.balance.low-coin"));
});

test("D85: Chat never pays from a chain wallet or the Safe; every send opens the money sheet, from Private only", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /"subwallet\.send"|"ledger\.transfer"|"ledger\.pay"/, "no public send from Chat");
  assert.match(app, /shell\.openMoney\(\{ kind: "send", link: sendLink\(\{ to: to\.address[\s\S]*?back: "chat" \}\) \}\)/, "the money sheet, marked as Chat's");
  assert.doesNotMatch(app, /approval\.answer|subwallet\.sign/);
  // control: the old path would be caught
  assert.match('void bridge.call("subwallet.send", ask)', /"subwallet\.send"/);
});
