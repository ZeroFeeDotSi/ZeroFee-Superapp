// Builder 25, item 1 (audit 19's J8, web side): the site-wallet chain lists read core app-chains.ts (product decision, 8 Nov: no BNB
// in V1, only SOL, NEAR and Robinhood). Settings did (audit 16's G9); Social trading's hub (its sums, "Solana $10.00 · BNB
// $2.40", the Take out lines) and the Browser's Your wallets still listed GMGN's BNB and Base wallets. The wallets' data
// stays where it is (nothing is deleted); the app just never shows a chain V1 doesn't carry. Fails on main 437575a59.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingWallet } from "@zerofee/core/spending";
import { SITE_CHAINS, hubRows, fundedLine, notCarried, pickable } from "./hub-state.ts";
import { siteWalletsOf, yourWallets } from "./your-wallets.ts";
import { stays, tooSmall, takeOutAlso } from "./take-out.ts";

const w = (id: string, network: string, usd: string): SpendingWallet => ({ id, role: "site", site: "gmgn", current: true, network, cashUsd: usd, coinsUsd: "0", label: "GMGN wallet", address: id } as unknown as SpendingWallet);
const list = [w("s", "sol", "10"), w("b", "bsc", "2.40"), w("e", "base", "1")];

test("Social trading's hub: only the app's chains count, by name", () => {
  const gmgn = hubRows(list).find((r) => r.site === "gmgn")!;
  assert.deepEqual(gmgn.wallets!.map((x) => x.network), ["sol"]);
  assert.equal(gmgn.usd, 10, "the sum is the SOL wallet's, never $13.40 with a BNB figure in it");
  assert.equal(gmgn.solUsd, 10);
  assert.equal(fundedLine(gmgn), "Solana $10.00");
  assert.deepEqual(stays(gmgn), []);
  assert.deepEqual(tooSmall(gmgn), []);
  assert.deepEqual(takeOutAlso(gmgn), []);
  assert.deepEqual(SITE_CHAINS.gmgn, ["sol"], "GMGN's sheet goes straight to its SOL wallet");
  assert.deepEqual(pickable("gmgn"), ["sol"]);
});

test("the line for a network the site trades on that V1 doesn't carry: what V1 does, no BNB, no Base, no $1,000", () => {
  for (const c of ["bsc", "base", "eth"] as const) {
    assert.equal(notCarried(c), "GMGN pays from its SOL wallet.");
    assert.doesNotMatch(notCarried(c), /BNB|Base|\$1,000/);
  }
});

test("Your wallets (Browser): only the app's chains, and the page's total is the SOL wallet's", () => {
  assert.deepEqual(siteWalletsOf(list).map((x) => x.network), ["sol"]);
  const page = yourWallets({ list, read: "ok" });
  assert.equal(page.total, "$10.00");
  assert.ok(!JSON.stringify(page).match(/BNB|Base/), JSON.stringify(page));
});

test("the site lists' own names carry no BNB or Base word", () => {
  const code = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const f of ["../app/site-wallet-lines.ts", "./your-wallets.ts", "./hub-state.ts", "./site-wallet.ts", "./SocialHub.tsx"]) assert.doesNotMatch(code(f), /"BNB|"Base"|BNB Chain|\$1,000/, f);
});
