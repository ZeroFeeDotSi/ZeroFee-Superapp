// D13 (product decision, 8 Nov): no BNB in V1, only SOL, NEAR and Robinhood. Builder 13's "BNB wallet · 0.08 BNB" row on Hot
// (and its "not counted" line), Details' BNB wallet, Trade's BNB chip and Move's BNB place go, behind one list (core
// app-chains.ts) so adding it later is one entry. The data stays (the ledger, the engine, the kept copy). Fails on main:
// Hot drew a BNB row from a BNB wallet holding coins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingWallet } from "@zerofee/core/spending";
import { APP_CHAINS, appChain } from "@zerofee/core/app-chains";
import { closedRows } from "./closed-rows.ts";
import { PLACES } from "./move-split.ts";

const bnb = { id: "bsc-1", role: "chain", network: "bsc", label: "BNB wallet", current: true, holds: "0.08 BNB", keyExported: false } as SpendingWallet;
const sol = { id: "sol-1", role: "chain", network: "sol", label: "SOL wallet", current: true, holds: "0.5 SOL", keyExported: false } as SpendingWallet;

test("D13: no BNB wallet row on Hot, so no line under its total; the app's chains are SOL, NEAR and Robinhood", () => {
  assert.deepEqual([...APP_CHAINS], ["sol", "near", "hood"]);
  assert.equal(appChain("bsc"), false);
  assert.deepEqual(closedRows([], [bnb], (c) => c), [], "fails on main: a BNB row with 0.08 BNB");
  assert.equal(closedRows([], [sol], (c) => c).length, 1, "control: a shown chain's wallet outside the cap still lists");
  assert.ok(!PLACES.includes("bsc"), "Move has no BNB place");
  assert.ok(PLACES.includes("sol") && PLACES.includes("hood") && PLACES.includes("near") && PLACES.includes("safe") && PLACES.includes("private"));
});

test("D13: Details lists no BNB wallet; Trade's Receive has no BNB chip; the data stays", () => {
  const details = readFileSync(new URL("./Details.tsx", import.meta.url), "utf8");
  assert.match(details, /\.filter\(\(w\) => w\.role !== "chain" \|\| appChain\(String\(w\.network\)\)\)/);
  const trade = readFileSync(new URL("../../../../trade/src/app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(trade, /\(\["sol", "hood", "bsc"\] as const\)\.filter\(\(c\) => appChain\(c\) && proven\(c\)\)/);
});
