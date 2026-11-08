// Audit 12 C7 (8 Nov): Details showed "BNB Chain wallet · Holds 0.08 BNB" and a second, empty "GMGN wallet · Base" that
// Hot named nowhere: Hot's $227.48 counted neither, said nothing, and said "GMGN · 1 wallet". Now Hot lists every Trade
// wallet that holds coins (a closed chain's with what it holds, never counted, said by name), and Details lists a site's
// wallets by Hot's own rule, so both say the same count. Fails on main: neither module nor rule exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closedLine, closedRows } from "./closed-rows.ts";
import { siteGroups, siteSections, siteWalletsShown } from "./safe-hot.ts";
import { sumUsd } from "../trading.ts";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const details = readFileSync(new URL("./Details.tsx", import.meta.url), "utf8");
const HOT = { sol: "SOL", hood: "Robinhood", near: "NEAR", bsc: "BNB" } as const;
const bnb = { id: "sw-trade-bsc", role: "chain", network: "bsc", address: "0xAb", label: "BNB wallet", current: true, inCap: false, holds: "0.08 BNB", keyExported: false };
const rows = [{ chain: "sol" }, { chain: "hood" }, { chain: "near" }] as const;

test("C7, then D13 (product decision, 8 Nov: no BNB in V1): a BNB wallet holding 0.08 BNB is no row on Hot; a shown chain's wallet outside the cap still is (control: empty or already a row, none)", () => {
  assert.deepEqual(closedRows(rows, [bnb] as never, (c) => HOT[c]), [], "D13: BNB is not one of the app's chains");
  const hood = { ...bnb, id: "hood-x", network: "hood", holds: "0.004 ETH" };
  const got = closedRows(rows.filter((r: { chain: string }) => r.chain !== "hood"), [hood] as never, (c) => HOT[c]);
  assert.deepEqual(got, [{ chain: "hood", name: HOT.hood, amount: "0.004 ETH", usd: null, coins: [], unpriced: true, outside: true }]);
  assert.equal(closedLine(["BNB wallet"]), "BNB wallet not counted. ZeroFee doesn't trade on BNB yet.", "it says why (QA 16)");
  assert.deepEqual(closedRows(rows, [{ ...bnb, holds: "0 BNB" }] as never, (c) => HOT[c]), [], "control: an empty one adds no row");
  assert.deepEqual(closedRows([...rows, { chain: "hood" }], [hood] as never, (c) => HOT[c]), [], "control: a counted row is never twice");
  assert.deepEqual(closedRows(rows.filter((r: { chain: string }) => r.chain !== "hood"), [{ ...hood, current: false }] as never, (c) => HOT[c]), [], "control: an older one stays in Details");
  // Home draws it: the row's amount where dollars go, the line under it, and the total never waits on it
  assert.match(home, /const rows = homeOwn \? \[\.\.\.homeOwn, \.\.\.closedRows\(homeOwn, wallets, \(c\) => ROW_NAME\[c\]\)\] : null;/);
  assert.match(home, /\{r\.outside && <p className="zf-small wl-list-empty" data-testid="hot-outside">\{closedLine\(\[HOT_NAME\[r\.chain\]\], ROW_NAME\[r\.chain\]\)\}<\/p>\}/);
  assert.match(home, /rows\?\.some\(\(r\) => r\.unpriced && !r\.outside\)/);
});

test("C7: Details shows a site's wallets by Hot's rule: GMGN's empty Base wallet beside its funded SOL one is left out of both (control: none funded, its first)", () => {
  const w = (o: Record<string, unknown>) => ({ role: "site", current: true, cashUsd: "25.00", coinsUsd: "2.47", inCap: false, keyExported: false, ...o });
  const list = [w({ id: "pump", site: "pump", label: "pump.fun wallet", network: "sol" }), w({ id: "g-sol", site: "gmgn", label: "GMGN wallet", network: "sol" }), w({ id: "g-base", site: "gmgn", label: "GMGN wallet", network: "base", cashUsd: undefined, coinsUsd: undefined, holds: "0 ETH" }), bnb];
  const shown = siteWalletsShown(list as never);
  assert.deepEqual(shown.map((x) => x.id), ["pump", "g-sol", "sw-trade-bsc"]);
  const hot = siteGroups(siteSections(list as never, () => null, sumUsd), sumUsd);
  assert.deepEqual(hot.map((g) => [g.name, g.wallets.length]), [["pump.fun", 1], ["GMGN", 1]], "Hot: GMGN · 1 wallet");
  assert.equal(shown.filter((x) => x.site === "gmgn").length, hot.find((g) => g.name === "GMGN")!.wallets.length, "the same count");
  // control: coins in its Base wallet (what it holds, no dollar figure), both show on both
  const both = list.map((x) => (x.id === "g-base" ? { ...x, holds: "0.004 ETH" } : x));
  assert.equal(siteWalletsShown(both as never).filter((x) => x.site === "gmgn").length, 2);
  assert.equal(siteGroups(siteSections(both as never, () => null, sumUsd), sumUsd).find((g) => g.name === "GMGN")!.wallets.length, 2, "Hot too: GMGN · 2 wallets");
  // control: none funded, the site's first stays
  assert.deepEqual(siteWalletsShown([w({ id: "a", site: "gmgn", cashUsd: "0.00", coinsUsd: "0.00" }), w({ id: "b", site: "gmgn", cashUsd: "0.00", coinsUsd: "0.00" })] as never).map((x) => x.id), ["a"]);
  assert.match(details, /const shown = siteWalletsShown\(/);
});
