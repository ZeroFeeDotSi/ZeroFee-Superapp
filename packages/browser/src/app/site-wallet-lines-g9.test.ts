// Audit 16's G9 (8 Nov): Settings listed "GMGN $0.00 · Base" while V1's chains are SOL, NEAR and Robinhood only (owner,
// 8 Nov). Settings' site wallets read the same chain list as Hot and Details (core app-chains.ts APP_CHAINS).
// Fails on main: the Base (and a BNB) site wallet was listed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingWallet } from "@zerofee/core/spending";
import { siteWalletLines } from "./site-wallet-lines.ts";

const base = { address: "A", inCap: false, keyExported: false, current: true, role: "site" } as const;
const list = [
  { ...base, id: "p", site: "pump", network: "sol", label: "pump.fun wallet", cashUsd: "25.00" },
  { ...base, id: "gs", site: "gmgn", network: "sol", label: "GMGN wallet", cashUsd: "2.00" },
  { ...base, id: "gb", site: "gmgn", network: "base", label: "GMGN wallet", holds: "0 ETH" },
  { ...base, id: "gn", site: "gmgn", network: "bsc", label: "GMGN wallet", holds: "0 BNB" },
] as SpendingWallet[];

test("G9: Settings lists no Base or BNB site wallet", () => {
  const lines = siteWalletLines(list);
  assert.deepEqual(lines.map((l) => l.id), ["p", "gs"], "fails on main: gb and gn listed");
  assert.ok(lines.every((l) => !/Base|BNB/.test(`${l.title} ${l.line}`)));
});

test("control: a Solana site wallet keeps its line", () => {
  assert.deepEqual(siteWalletLines(list.slice(0, 1)), [{ id: "p", title: "pump.fun $25.00", line: "Solana" }]);
});
