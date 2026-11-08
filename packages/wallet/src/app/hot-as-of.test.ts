// Audit 13's D7 (8 Nov): Solana down, Hot showed the SOL wallet's figure with no time, and pump.fun and GMGN said "Can't see
// it now" twice and were left out of Hot's number though they read $27.47 minutes before. Now Home's kept copy keeps each
// wallet's last read and its time; a wallet that can't be read now shows that figure "As of" then and counts, as the Safe
// does with NEAR down (M12-3); the down words are said once. Fails on main: no keepReads, keptReads, siteDetail, chainAsOf.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingWallet } from "@zerofee/core/spending";
import { keepReads } from "./home-keep.ts";
import { keptReads } from "./home-cache.ts";
import { chainAsOf, hotAsOf, siteDetail, siteGroups, siteSections } from "./screens/safe-hot.ts";
import { clock } from "./screens/home-view.ts";
const safeAsOf = (at: number) => `As of ${clock(at)}`;

const T = Date.UTC(2026, 10, 8, 2, 43);
const pump: SpendingWallet = { id: "pump-1", role: "site", site: "pump", label: "pump.fun wallet", network: "sol", current: true, cashUsd: "27.47", coinsUsd: "0", keyExported: false } as SpendingWallet;
const sol: SpendingWallet = { id: "sol-1", role: "chain", label: "SOL wallet", network: "sol", current: true, cashUsd: "119.37", coinsUsd: "0", keyExported: false } as SpendingWallet;
const down = (w: SpendingWallet): SpendingWallet => ({ ...w, cashUsd: undefined, unread: true } as SpendingWallet);
const sum = (xs: (string | null | undefined)[]) => xs.reduce((n, x) => n + (Number(x) || 0), 0).toFixed(2);

test("D7: the kept copy keeps each wallet's last read and when; a wallet down shows it as of then", () => {
  const kept = keepReads([pump, sol], undefined, T);
  assert.equal(kept[0]!.readAt, T);
  const later = keepReads([down(pump), down(sol)], kept, T + 60_000);
  assert.equal(later[0]!.cashUsd, "27.47", "the last read stays in the copy");
  assert.equal(later[0]!.readAt, T, "with that read's time, never the failed read's");
  const shown = keptReads([down(pump), down(sol)], kept)!;
  assert.equal(shown[0]!.unread, undefined, "counted again");
  assert.equal(shown[0]!.cashUsd, "27.47");
  assert.equal(shown[0]!.asOf, T);
  const groups = siteGroups(siteSections(shown, () => null, sum), sum);
  assert.equal(groups[0]!.usd, "27.47");
  assert.equal(groups[0]!.asOf, T);
  assert.equal(siteDetail(groups[0]!, (u) => `$${u}`), "1 wallet", "the figure once (its row's); the time once, under Hot's total");
  assert.equal(hotAsOf(shown), T, "Hot's total says it: As of then");
  assert.equal(chainAsOf(shown, "sol"), T, "the SOL wallet's kept read has its time (Hot's total says it)");
});

test("control: never read, it stays unread and the down words are said once; read now, no time", () => {
  const never = keptReads([down(pump)], [])!;
  assert.equal(never[0]!.unread, true);
  const g = siteGroups(siteSections(never, () => null, sum), sum)[0]!;
  assert.equal(siteDetail(g, (u) => `$${u}`), "1 wallet", "fails on main: \"1 wallet · Can't see it now\" beside the row's own \"Can't see it now\"");
  const up = siteGroups(siteSections([pump], () => null, sum), sum)[0]!;
  assert.equal(siteDetail(up, (u) => `$${u}`), "1 wallet · $27.47");
  assert.equal(chainAsOf([sol], "sol"), undefined);
  assert.equal(hotAsOf([sol, pump]), undefined, "all read now: Hot's total says no time");
  assert.equal(chainAsOf([down(sol)], "sol"), undefined, "no kept read: no made-up time");
});

test("D7 at 390 pt (QA's SHOULD): Hot's time is said once, under its total, never on a row", async () => {
  const { readFileSync } = await import("node:fs");
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /const hotAt = !web && tab === "hot" \? hotAsOf\(wallets\) : undefined;/);
  assert.match(home, /: hotAt \? safeAsOf\(hotAt\) : null;/, "the total's slot, as the Safe's As of");
  assert.doesNotMatch(home, /data-testid="hot-as-of"|\[names, safeAsOf\(asOf\)\]/, "no time per row (was cut to \"0.9835 SOL · A…\")");
});
