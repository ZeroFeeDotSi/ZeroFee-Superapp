// Builder 22's item 4 (audit 12 S8, audit 16/17 S16-1, 8 Nov): with ?demo&fault=hood:521 Hot showed "Robinhood wallet
// 0.012 ETH $28.17" with no time, because the rig marked only Solana's wallets unread. Robinhood Chain down now leaves
// the Robinhood wallet unread as Solana down leaves the SOL wallet, so Hot keeps its last read and says "As of HH:MM"
// once under its total (home-cache keptReads, safe-hot hotAsOf), the banner naming Robinhood Chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { faultedBridge } from "./faults.ts";
import { keptReads } from "@zerofee/wallet/app/home-cache.ts";
import { hotAsOf } from "@zerofee/wallet/app/screens/safe-hot.ts";
import { downLine } from "@zerofee/core/services";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingWallet } from "@zerofee/core/spending";

const WALLETS = [
  { id: "sol-1", role: "chain", network: "sol", label: "SOL wallet", current: true, inCap: true, cashUsd: "144.37", coinsUsd: "0.00" },
  { id: "hood-1", role: "chain", network: "hood", label: "Robinhood wallet", current: true, inCap: true, cashUsd: "28.17", coinsUsd: "0.00" },
  { id: "near-1", role: "chain", network: "near", label: "NEAR wallet", current: true, inCap: true, cashUsd: "0.00", coinsUsd: "0.00" },
];
const inner: Bridge = { call: async (m: string) => ({ ok: (m === "spending.wallets" ? WALLETS : "read") as never }), on: () => () => undefined } as never;
const unreadOf = async (service: "hood" | "solana") => {
  const r = await faultedBridge(inner, { service, failure: 521 }).call<{ id: string; unread?: boolean }[]>("spending.wallets");
  assert.ok("ok" in r);
  return r.ok.filter((w) => w.unread).map((w) => w.id);
};

test("hood-down-b22: Robinhood Chain down leaves the Robinhood wallet unread, as Solana down leaves the SOL wallet", async () => {
  assert.deepEqual(await unreadOf("hood"), ["hood-1"]);
  assert.deepEqual(await unreadOf("solana"), ["sol-1"], "control: Solana's case as before");
});

test("hood-down-b22: Hot keeps the Robinhood wallet's last read and says when, once", async () => {
  const r = await faultedBridge(inner, { service: "hood", failure: 521 }).call<SpendingWallet[]>("spending.wallets");
  assert.ok("ok" in r);
  const at = Date.UTC(2026, 10, 8, 10, 47);
  const kept = WALLETS.map((w) => ({ ...w, readAt: at })) as unknown as SpendingWallet[];
  const shown = keptReads(r.ok, kept)!;
  const hood = shown.find((w) => w.id === "hood-1")!;
  assert.equal(hood.cashUsd, "28.17");
  assert.equal(hood.asOf, at);
  assert.equal(hotAsOf(shown), at, "Hot's total says As of 10:47");
  assert.match(downLine("hood"), /^Robinhood Chain is down\./);
});
