// Audit 12 C8: Details said "Solana wallet" and "Robinhood Chain wallet" where Home's Hot says "SOL wallet" and
// "Robinhood wallet". One name per wallet everywhere: the core's Details label is Home's Hot name; the chain's own name
// stays on the line under it (and on Settings, Status: "Robinhood Chain").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NETWORK_NAME, WALLET_LABEL, WALLET_NAME } from "./spending.ts";

const home = readFileSync(new URL("../../wallet/src/app/screens/Home.tsx", import.meta.url), "utf8");
const lister = readFileSync(new URL("./spending-wallets.ts", import.meta.url), "utf8");
const mock = readFileSync(new URL("../../shell-api/src/MockBridge.ts", import.meta.url), "utf8");

test("C8: a wallet's Details name is Home's Hot name (control: the chain keeps its own name)", () => {
  const hot = /export const HOT_NAME: Record<RowChain, string> = \{ sol: "([^"]+)", hood: "([^"]+)", near: "[^"]+", bsc: "([^"]+)" \};/.exec(home);
  assert.ok(hot, "Home's HOT_NAME");
  assert.deepEqual([WALLET_LABEL.sol, WALLET_LABEL.hood, WALLET_LABEL.bsc], [hot[1], hot[2], hot[3]]);
  assert.deepEqual([WALLET_NAME.sol, WALLET_NAME.hood], ["your SOL wallet", "your Robinhood wallet"], "the sheets' name is the same name");
  assert.match(lister, /const name = WALLET_LABEL\[w\.chain as SpendingNetwork\];/);
  assert.equal((lister.match(/label: current \? name : `Older \$\{name\}`/g) ?? []).length, 2);
  assert.doesNotMatch(mock, /"Solana wallet"|"Robinhood Chain wallet"|"BNB Chain wallet"/, "the Sim's own list too");
  // control: the chain line and Status keep the chain's name
  assert.deepEqual([NETWORK_NAME.sol, NETWORK_NAME.hood, NETWORK_NAME.bsc], ["Solana", "Robinhood Chain", "BNB Chain"]);
});
